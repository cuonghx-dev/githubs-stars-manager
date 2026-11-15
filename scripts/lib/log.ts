// Per-step summary lines for the pipeline (FR-13), e.g.
//   [sync] added=3 removed=1 changed=12 readmes=15 (2.4s)
// The writer and clock are injectable so tests can capture output.

export type Counts = Record<string, number>;

export interface StepLog {
  /** Add `n` (default 1) to a named counter. */
  count(name: string, n?: number): void;
  /** Set a named counter to an absolute value. */
  set(name: string, value: number): void;
  /** Print a progress/info line prefixed with the step name. */
  info(message: string): void;
  warn(message: string): void;
  /** Print the summary line once and return the counts and duration. */
  done(): { counts: Counts; ms: number };
}

export interface Logger {
  step(name: string): StepLog;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface LoggerOptions {
  write?: (line: string) => void;
  writeError?: (line: string) => void;
  now?: () => number;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${seconds}s`;
}

/** `[step] a=1 b=2 (1.2s)`; counters keep insertion order. */
export function formatSummary(
  step: string,
  counts: Counts,
  ms: number,
): string {
  const parts = Object.entries(counts).map(([k, v]) => `${k}=${v}`);
  const body = parts.length ? `${parts.join(" ")} ` : "";
  return `[${step}] ${body}(${formatDuration(ms)})`;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const write = options.write ?? ((line) => console.log(line));
  const writeError = options.writeError ?? ((line) => console.error(line));
  const now = options.now ?? (() => performance.now());

  return {
    step(name) {
      const start = now();
      const counts: Counts = {};
      let finished: { counts: Counts; ms: number } | undefined;
      return {
        count(key, n = 1) {
          counts[key] = (counts[key] ?? 0) + n;
        },
        set(key, value) {
          counts[key] = value;
        },
        info: (message) => write(`[${name}] ${message}`),
        warn: (message) => writeError(`[${name}] warning: ${message}`),
        done() {
          if (finished) return finished;
          const ms = now() - start;
          finished = { counts: { ...counts }, ms };
          write(formatSummary(name, counts, ms));
          return finished;
        },
      };
    },
    info: (message) => write(message),
    warn: (message) => writeError(`warning: ${message}`),
    error: (message) => writeError(`error: ${message}`),
  };
}
