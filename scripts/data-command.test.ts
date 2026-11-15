import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// FR-10: `pnpm data` runs the pipeline steps in order, and each step is also
// a separate command. M1 has no embed step yet (added in M2, T2.8), so the
// chain is sync -> build-graph.
const pkg = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8"),
) as { scripts: Record<string, string> };

describe("pnpm data", () => {
  it("chains sync then build-graph, stopping on the first failure", () => {
    expect(pkg.scripts.data).toBe("pnpm sync && pnpm build-graph");
  });

  it("only references steps that exist as their own scripts", () => {
    const steps = (pkg.scripts.data ?? "")
      .split("&&")
      .map((s) => s.trim().replace(/^pnpm /, ""));
    for (const step of steps) {
      expect(pkg.scripts[step], `script "${step}"`).toBeDefined();
    }
  });
});
