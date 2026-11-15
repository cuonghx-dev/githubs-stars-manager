import { describe, expect, it } from "vitest";
import config from "./graph.config.ts";

describe("graph.config", () => {
  it("uses the FR-21 weights, summing to 1", () => {
    expect(config.weights).toEqual({
      semantic: 0.55,
      topic: 0.2,
      mention: 0.15,
      dependency: 0.07,
      owner: 0.03,
    });
    const sum = Object.values(config.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("matches the PRD §7.2 defaults", () => {
    expect(config.semanticRange).toEqual([0.3, 0.9]);
    expect(config.k).toBe(6);
    expect(config.minWeight).toBe(0.15);
    expect(config.minClusterSize).toBe(3);
    expect(config.layout.iterations).toBe(500);
    expect(config.duplicateThreshold).toBe(0.85);
    expect(config.includePrivate).toBe(false);
    expect(config.readmeConcurrency).toBe(8);
    expect(config.embedding.modelId).toBe("Xenova/all-MiniLM-L6-v2");
    expect(config.base).toBe("./");
  });

  it("encodes the FR-62 forgotten-star rules", () => {
    expect(config.forgotten).toEqual({
      starredOlderThanDays: 365,
      maxDegree: 1,
      includeArchived: true,
      pushedOlderThanDays: 730,
    });
  });

  it("uses integer seeds for deterministic runs (NFR-4)", () => {
    expect(Number.isInteger(config.louvain.seed)).toBe(true);
    expect(Number.isInteger(config.layout.seed)).toBe(true);
    expect(config.louvain.resolution).toBeGreaterThan(0);
  });

  it("has a valid semantic range", () => {
    const [min, max] = config.semanticRange;
    expect(min).toBeLessThan(max);
  });
});
