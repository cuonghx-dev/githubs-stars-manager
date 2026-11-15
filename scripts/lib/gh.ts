// Thin wrapper around the GitHub CLI (`gh api`, `gh api graphql`) (FR-13).
//
// - The process runner is injectable so tests never touch the network (NFR-10).
// - Transient failures (HTTP 5xx, secondary rate limit, network errors) are
//   retried 3 times with 1 s / 2 s / 4 s back-off.
// - `assertAuth()` runs `gh auth status` and stops the run with a clear message
//   when `gh` is missing or not logged in.

import { execa } from "execa";

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** Process exit code; `-1` when the binary could not be started. */
  exitCode: number;
}

export interface ExecOptions {
  /** Written to the child's stdin. */
  input?: string;
}

export type Exec = (
  file: string,
  args: readonly string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

export type Sleep = (ms: number) => Promise<void>;

/** Default runner: execa without throwing, so exit codes are inspected here. */
export const defaultExec: Exec = async (file, args, options = {}) => {
  const result = await execa(file, [...args], {
    reject: false,
    input: options.input,
    stripFinalNewline: false,
  });
  const exitCode = typeof result.exitCode === "number" ? result.exitCode : -1;
  const stderr = result.stderr || (result.failed ? (result.message ?? "") : "");
  return { stdout: result.stdout ?? "", stderr, exitCode };
};

const defaultSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Back-off before each retry: 3 retries after the first attempt. */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];

export type GhErrorKind =
  | "http"
  | "server"
  | "secondary-rate-limit"
  | "network"
  | "auth"
  | "not-installed"
  | "other";

export class GhError extends Error {
  override readonly name = "GhError";
  constructor(
    message: string,
    readonly kind: GhErrorKind,
    /** HTTP status parsed from `gh` output, when present. */
    readonly status: number | undefined,
    readonly stderr: string,
    readonly exitCode: number,
  ) {
    super(message);
  }

  get transient(): boolean {
    return (
      this.kind === "server" ||
      this.kind === "secondary-rate-limit" ||
      this.kind === "network"
    );
  }
}

export class GhAuthError extends Error {
  override readonly name = "GhAuthError";
}

const NETWORK_PATTERNS = [
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /EAI_AGAIN/i,
  /ENOTFOUND/i,
  /connection reset/i,
  /connection refused/i,
  /i\/o timeout/i,
  /TLS handshake timeout/i,
  /no such host/i,
  /dial tcp/i,
  /unexpected EOF/i,
  /network is unreachable/i,
  /context deadline exceeded/i,
];

const SECONDARY_RATE_LIMIT_PATTERNS = [
  /secondary rate limit/i,
  /abuse detection/i,
];

export function parseHttpStatus(stderr: string): number | undefined {
  const match = /\bHTTP (\d{3})\b/.exec(stderr);
  return match?.[1] ? Number(match[1]) : undefined;
}

/** Classify a failed `gh` invocation from its stderr and exit code. */
export function classifyFailure(result: ExecResult): GhError {
  const { stderr, exitCode } = result;
  const status = parseHttpStatus(stderr);
  const firstLine = stderr.trim().split("\n")[0] ?? "";
  const message = firstLine || `gh exited with code ${exitCode}`;

  let kind: GhErrorKind;
  if (exitCode === -1 && /ENOENT/.test(stderr)) kind = "not-installed";
  else if (SECONDARY_RATE_LIMIT_PATTERNS.some((p) => p.test(stderr)))
    kind = "secondary-rate-limit";
  else if (status !== undefined && status >= 500) kind = "server";
  else if (status === 401) kind = "auth";
  else if (status !== undefined) kind = "http";
  else if (NETWORK_PATTERNS.some((p) => p.test(stderr))) kind = "network";
  else kind = "other";

  return new GhError(message, kind, status, stderr, exitCode);
}

export interface GhLogger {
  warn(message: string): void;
  error(message: string): void;
}

export interface GhClientOptions {
  exec?: Exec;
  sleep?: Sleep;
  logger?: GhLogger;
  /** Called by `assertAuth()` on failure; defaults to `process.exit`. */
  exit?: (code: number) => never;
  /** Override for tests; defaults to `RETRY_DELAYS_MS`. */
  retryDelaysMs?: readonly number[];
  /** Binary name, `gh` by default. */
  bin?: string;
}

export interface ApiOptions {
  /** Extra request headers, e.g. `{ Accept: "application/vnd.github.raw" }`. */
  headers?: Record<string, string>;
  method?: string;
}

export interface GhClient {
  /** `gh api <path>`; resolves with the raw response body. */
  api(path: string, options?: ApiOptions): Promise<string>;
  /** `gh api <path>` parsed as JSON. */
  apiJson<T>(path: string, options?: ApiOptions): Promise<T>;
  /** `gh api graphql` with the query and variables sent as a JSON body. */
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
  /** Run `gh auth status`; exit the process with a clear message on failure. */
  assertAuth(): Promise<void>;
}

export const AUTH_HELP =
  "GitHub CLI is not authenticated. Run `gh auth login` and try again.";
export const INSTALL_HELP =
  "GitHub CLI (`gh`) was not found on PATH. Install it from https://cli.github.com and run `gh auth login`.";

const consoleLogger: GhLogger = {
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

export function createGh(options: GhClientOptions = {}): GhClient {
  const exec = options.exec ?? defaultExec;
  const sleep = options.sleep ?? defaultSleep;
  const logger = options.logger ?? consoleLogger;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  const bin = options.bin ?? "gh";

  async function run(
    args: readonly string[],
    execOptions?: ExecOptions,
  ): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      const result = await exec(bin, args, execOptions);
      if (result.exitCode === 0) return result.stdout;

      const error = classifyFailure(result);
      const delay = delays[attempt];
      if (!error.transient || delay === undefined) throw error;

      logger.warn(
        `gh ${args[0] ?? ""} ${args[1] ?? ""}: ${error.kind} (${error.message}); retry ${attempt + 1}/${delays.length} in ${delay / 1000}s`,
      );
      await sleep(delay);
    }
  }

  function apiArgs(path: string, opts: ApiOptions = {}): string[] {
    const args = ["api", path];
    if (opts.method) args.push("--method", opts.method);
    for (const [name, value] of Object.entries(opts.headers ?? {})) {
      args.push("-H", `${name}: ${value}`);
    }
    return args;
  }

  return {
    api: (path, opts) => run(apiArgs(path, opts)),

    async apiJson<T>(path: string, opts?: ApiOptions): Promise<T> {
      return JSON.parse(await run(apiArgs(path, opts))) as T;
    },

    async graphql<T>(
      query: string,
      variables: Record<string, unknown> = {},
    ): Promise<T> {
      const body = JSON.stringify({ query, variables });
      const stdout = await run(["api", "graphql", "--input", "-"], {
        input: body,
      });
      const parsed = JSON.parse(stdout) as {
        data?: T;
        errors?: { message: string }[];
      };
      if (parsed.errors?.length) {
        const message = parsed.errors.map((e) => e.message).join("; ");
        throw new GhError(`GraphQL: ${message}`, "other", undefined, "", 0);
      }
      if (parsed.data === undefined) {
        throw new GhError("GraphQL: empty response", "other", undefined, "", 0);
      }
      return parsed.data;
    },

    async assertAuth(): Promise<void> {
      const result = await exec(bin, ["auth", "status"]);
      if (result.exitCode === 0) return;
      const notInstalled =
        result.exitCode === -1 && /ENOENT/.test(result.stderr);
      logger.error(notInstalled ? INSTALL_HELP : AUTH_HELP);
      exit(1);
    },
  };
}
