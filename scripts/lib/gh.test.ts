import { describe, expect, it, vi } from "vitest";
import {
  AUTH_HELP,
  classifyFailure,
  createGh,
  GhError,
  INSTALL_HELP,
  RETRY_DELAYS_MS,
  type Exec,
  type ExecResult,
} from "./gh.ts";

const ok = (stdout: string): ExecResult => ({
  stdout,
  stderr: "",
  exitCode: 0,
});
const fail = (stderr: string, exitCode = 1): ExecResult => ({
  stdout: "",
  stderr,
  exitCode,
});

function fakeExec(results: ExecResult[]) {
  const calls: { file: string; args: readonly string[]; input?: string }[] = [];
  const exec: Exec = async (file, args, options) => {
    calls.push({ file, args, input: options?.input });
    const next = results.shift();
    if (!next) throw new Error("fake exec: no more results");
    return next;
  };
  return { exec, calls };
}

function setup(results: ExecResult[]) {
  const { exec, calls } = fakeExec(results);
  const sleeps: number[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const gh = createGh({
    exec,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    logger: { warn: (m) => warnings.push(m), error: (m) => errors.push(m) },
    exit: ((code: number) => {
      throw new Error(`exit ${code}`);
    }) as (code: number) => never,
  });
  return { gh, calls, sleeps, warnings, errors };
}

describe("classifyFailure", () => {
  it.each([
    ["gh: Server Error (HTTP 502)", "server", 502],
    ["gh: Service Unavailable (HTTP 503)", "server", 503],
    [
      "gh: You have exceeded a secondary rate limit. (HTTP 403)",
      "secondary-rate-limit",
      403,
    ],
    ["gh: Not Found (HTTP 404)", "http", 404],
    ["gh: Bad credentials (HTTP 401)", "auth", 401],
    [
      'Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host',
      "network",
      undefined,
    ],
    ["read tcp 1.2.3.4: connection reset by peer", "network", undefined],
    ["something odd", "other", undefined],
  ] as const)("%s → %s", (stderr, kind, status) => {
    const error = classifyFailure(fail(stderr));
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
  });

  it("treats a spawn ENOENT as not-installed", () => {
    expect(classifyFailure(fail("spawn gh ENOENT", -1)).kind).toBe(
      "not-installed",
    );
  });
});

describe("gh.api", () => {
  it("passes path, method and headers to gh api", async () => {
    const { gh, calls } = setup([ok("# readme")]);
    const body = await gh.api("repos/a/b/readme", {
      headers: { Accept: "application/vnd.github.raw" },
    });
    expect(body).toBe("# readme");
    expect(calls[0]).toMatchObject({
      file: "gh",
      args: [
        "api",
        "repos/a/b/readme",
        "-H",
        "Accept: application/vnd.github.raw",
      ],
    });
  });

  it("parses JSON with apiJson", async () => {
    const { gh } = setup([ok('{"login":"me"}')]);
    await expect(gh.apiJson<{ login: string }>("user")).resolves.toEqual({
      login: "me",
    });
  });

  it("retries 5xx with 1/2/4 s back-off and then succeeds", async () => {
    const { gh, calls, sleeps, warnings } = setup([
      fail("gh: Bad Gateway (HTTP 502)"),
      fail("gh: Service Unavailable (HTTP 503)"),
      fail("dial tcp: i/o timeout"),
      ok("done"),
    ]);
    await expect(gh.api("user")).resolves.toBe("done");
    expect(calls).toHaveLength(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
    expect(RETRY_DELAYS_MS).toEqual([1000, 2000, 4000]);
    expect(warnings).toHaveLength(3);
  });

  it("retries the secondary rate limit", async () => {
    const { gh, sleeps } = setup([
      fail("gh: You have exceeded a secondary rate limit (HTTP 403)"),
      ok("x"),
    ]);
    await expect(gh.api("user")).resolves.toBe("x");
    expect(sleeps).toEqual([1000]);
  });

  it("gives up after 3 retries and throws the last error", async () => {
    const { gh, calls, sleeps } = setup([
      fail("gh: Server Error (HTTP 500)"),
      fail("gh: Server Error (HTTP 500)"),
      fail("gh: Server Error (HTTP 500)"),
      fail("gh: Server Error (HTTP 504)"),
    ]);
    const error = await gh.api("user").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GhError);
    expect((error as GhError).status).toBe(504);
    expect(calls).toHaveLength(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it("does not retry a 404", async () => {
    const { gh, calls, sleeps } = setup([fail("gh: Not Found (HTTP 404)")]);
    const error = (await gh
      .api("repos/a/b/readme")
      .catch((e: unknown) => e)) as GhError;
    expect(error.status).toBe(404);
    expect(error.transient).toBe(false);
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });
});

describe("gh.graphql", () => {
  it("sends query and variables as a JSON body on stdin", async () => {
    const { gh, calls } = setup([ok('{"data":{"viewer":{"login":"me"}}}')]);
    const data = await gh.graphql<{ viewer: { login: string } }>(
      "query($n:Int!){viewer{login}}",
      { n: 100, after: null },
    );
    expect(data).toEqual({ viewer: { login: "me" } });
    expect(calls[0]?.args).toEqual(["api", "graphql", "--input", "-"]);
    expect(JSON.parse(calls[0]?.input ?? "")).toEqual({
      query: "query($n:Int!){viewer{login}}",
      variables: { n: 100, after: null },
    });
  });

  it("throws on GraphQL errors in the response", async () => {
    const { gh } = setup([ok('{"errors":[{"message":"bad field"}]}')]);
    await expect(gh.graphql("{x}")).rejects.toThrow("GraphQL: bad field");
  });

  it("retries a transient failure", async () => {
    const { gh, sleeps } = setup([
      fail("gh: Bad Gateway (HTTP 502)"),
      ok('{"data":{"ok":true}}'),
    ]);
    await expect(gh.graphql("{ok}")).resolves.toEqual({ ok: true });
    expect(sleeps).toEqual([1000]);
  });
});

describe("gh.assertAuth", () => {
  it("returns when gh auth status succeeds", async () => {
    const { gh, calls } = setup([ok("Logged in")]);
    await expect(gh.assertAuth()).resolves.toBeUndefined();
    expect(calls[0]?.args).toEqual(["auth", "status"]);
  });

  it("exits 1 with a login hint when not authenticated", async () => {
    const { gh, errors } = setup([
      fail("You are not logged into any GitHub hosts."),
    ]);
    await expect(gh.assertAuth()).rejects.toThrow("exit 1");
    expect(errors).toEqual([AUTH_HELP]);
  });

  it("exits 1 with an install hint when gh is missing", async () => {
    const { gh, errors } = setup([fail("spawn gh ENOENT", -1)]);
    await expect(gh.assertAuth()).rejects.toThrow("exit 1");
    expect(errors).toEqual([INSTALL_HELP]);
  });

  it("uses process.exit by default", async () => {
    const { exec } = fakeExec([fail("not logged in")]);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const gh = createGh({ exec, logger: { warn() {}, error() {} } });
    await gh.assertAuth();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
