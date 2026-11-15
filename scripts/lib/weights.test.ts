import { describe, expect, it } from "vitest";
import config from "../../config/graph.config.ts";
import {
  combinedWeight,
  isForced,
  renormalizeWeights,
  rescaleSemantic,
} from "./weights.ts";

const W = config.weights;

describe("renormalizeWeights", () => {
  it("keeps the configured weights when every signal is enabled", () => {
    const w = renormalizeWeights(W, [
      "semantic",
      "topic",
      "mention",
      "dependency",
      "owner",
    ]);
    expect(w).toEqual({ ...W });
  });

  it("M1 (topic/mention/owner) renormalises to 0.526/0.395/0.079", () => {
    const w = renormalizeWeights(W, ["topic", "mention", "owner"]);
    expect(w.topic).toBeCloseTo(0.526, 3);
    expect(w.mention).toBeCloseTo(0.395, 3);
    expect(w.owner).toBeCloseTo(0.079, 3);
    expect(w.semantic).toBe(0);
    expect(w.dependency).toBe(0);
    expect(w.topic + w.mention + w.owner).toBeCloseTo(1, 12);
  });

  it("rejects an empty or all-zero selection and negative weights", () => {
    expect(() => renormalizeWeights(W, [])).toThrow(/no enabled signal/);
    expect(() => renormalizeWeights({ ...W, topic: 0 }, ["topic"])).toThrow(
      /no enabled signal/,
    );
    expect(() => renormalizeWeights({ ...W, owner: -1 }, ["topic"])).toThrow(
      /owner/,
    );
  });
});

describe("rescaleSemantic", () => {
  it("maps [0.3, 0.9] to [0, 1] and clamps", () => {
    expect(rescaleSemantic(0.3, [0.3, 0.9])).toBe(0);
    expect(rescaleSemantic(0.6, [0.3, 0.9])).toBeCloseTo(0.5, 12);
    expect(rescaleSemantic(0.9, [0.3, 0.9])).toBe(1);
    expect(rescaleSemantic(0.1, [0.3, 0.9])).toBe(0);
    expect(rescaleSemantic(0.99, [0.3, 0.9])).toBe(1);
  });

  it("rejects an empty range", () => {
    expect(() => rescaleSemantic(0.5, [0.5, 0.5])).toThrow();
  });
});

describe("combinedWeight", () => {
  const m1 = renormalizeWeights(W, ["topic", "mention", "owner"]);
  const all = renormalizeWeights(W, [
    "semantic",
    "topic",
    "mention",
    "dependency",
    "owner",
  ]);
  const range = config.semanticRange;

  it("sums coefficient × signal", () => {
    expect(combinedWeight({ topic: 0.5 }, m1, range)).toBeCloseTo(
      0.5 * m1.topic,
      12,
    );
    expect(combinedWeight({ mention: true }, m1, range)).toBeCloseTo(
      m1.mention,
      12,
    );
    expect(
      combinedWeight({ topic: 1, mention: true, owner: true }, m1, range),
    ).toBeCloseTo(1, 12);
  });

  it("is 0 for no signals and ignores false booleans", () => {
    expect(combinedWeight({}, m1, range)).toBe(0);
    expect(combinedWeight({ mention: false, owner: false }, m1, range)).toBe(0);
  });

  it("owner alone stays below minWeight in M1", () => {
    expect(combinedWeight({ owner: true }, m1, range)).toBeLessThan(
      config.minWeight,
    );
  });

  it("rescales semantic and ignores signals with zero coefficient", () => {
    expect(combinedWeight({ semantic: 0.6 }, all, range)).toBeCloseTo(
      0.55 * 0.5,
      12,
    );
    expect(combinedWeight({ semantic: 0.9 }, m1, range)).toBe(0);
  });
});

describe("isForced", () => {
  it("is true for mention, dependency and manual edges only", () => {
    expect(isForced({ mention: true })).toBe(true);
    expect(isForced({ dependency: true })).toBe(true);
    expect(isForced({ manual: "alternative-of" })).toBe(true);
    expect(isForced({ topic: 1, owner: true })).toBe(false);
    expect(isForced({ mention: false })).toBe(false);
  });
});
