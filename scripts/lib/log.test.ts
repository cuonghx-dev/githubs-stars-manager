import { describe, expect, it } from "vitest";
import { createLogger, formatDuration, formatSummary } from "./log.ts";

function capture(times: number[]) {
  const out: string[] = [];
  const err: string[] = [];
  const logger = createLogger({
    write: (l) => out.push(l),
    writeError: (l) => err.push(l),
    now: () => times.shift() ?? 0,
  });
  return { logger, out, err };
}

describe("formatDuration", () => {
  it.each([
    [42, "42ms"],
    [2400, "2.4s"],
    [125_000, "2m5s"],
  ])("%d → %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe("formatSummary", () => {
  it("prints counters in insertion order", () => {
    expect(formatSummary("sync", { added: 3, removed: 1 }, 2400)).toBe(
      "[sync] added=3 removed=1 (2.4s)",
    );
  });

  it("handles no counters", () => {
    expect(formatSummary("embed", {}, 10)).toBe("[embed] (10ms)");
  });
});

describe("createLogger", () => {
  it("accumulates counters and prints one summary line", () => {
    const { logger, out } = capture([1000, 3400]);
    const step = logger.step("sync");
    step.count("added", 2);
    step.count("added");
    step.count("removed", 0);
    step.set("readmes", 15);
    step.info("page 1");
    const result = step.done();
    step.done();
    expect(result).toEqual({
      counts: { added: 3, removed: 0, readmes: 15 },
      ms: 2400,
    });
    expect(out).toEqual([
      "[sync] page 1",
      "[sync] added=3 removed=0 readmes=15 (2.4s)",
    ]);
  });

  it("routes warnings and errors to the error writer", () => {
    const { logger, err } = capture([0]);
    logger.step("build-graph").warn("graph.json > 3 MB");
    logger.warn("w");
    logger.error("e");
    expect(err).toEqual([
      "[build-graph] warning: graph.json > 3 MB",
      "warning: w",
      "error: e",
    ]);
  });
});
