import { describe, expect, it } from "vitest";
import {
  candidatePairs,
  cosine,
  jaccard,
  orderSignals,
  ownerOf,
  pairKey,
} from "./signals.ts";

describe("cosine", () => {
  it("is 1 for parallel and -1 for opposite vectors", () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 12);
  });

  it("is 0 for orthogonal or zero vectors", () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it("accepts typed arrays and rejects length mismatch", () => {
    expect(
      cosine(new Float32Array([1, 1]), new Float32Array([1, 1])),
    ).toBeCloseTo(1, 6);
    expect(() => cosine([1], [1, 2])).toThrow(/length mismatch/);
  });
});

describe("jaccard", () => {
  it("returns |A∩B| / |A∪B| and the sorted shared members", () => {
    expect(jaccard(["b", "a", "c"], ["c", "b", "d"])).toEqual({
      value: 2 / 4,
      shared: ["b", "c"],
    });
  });

  it("is 0 when either set is empty", () => {
    expect(jaccard([], ["a"])).toEqual({ value: 0, shared: [] });
    expect(jaccard(["a"], [])).toEqual({ value: 0, shared: [] });
    expect(jaccard([], [])).toEqual({ value: 0, shared: [] });
  });

  it("ignores duplicates", () => {
    expect(jaccard(["a", "a"], ["a"]).value).toBe(1);
  });
});

describe("ownerOf / pairKey", () => {
  it("lowercases the owner", () => {
    expect(ownerOf("Facebook/react")).toBe("facebook");
  });

  it("is order-independent", () => {
    expect(pairKey("a/x", "b/y")).toBe(pairKey("b/y", "a/x"));
  });
});

describe("candidatePairs", () => {
  const repos = [
    { nameWithOwner: "facebook/react", topics: ["react", "ui", "javascript"] },
    { nameWithOwner: "pmndrs/zustand", topics: ["react", "state"] },
    { nameWithOwner: "pmndrs/jotai", topics: ["React", "state", "atom"] },
    { nameWithOwner: "Facebook/jest", topics: [] },
    { nameWithOwner: "lone/repo", topics: ["rust"] },
  ];

  it("builds topic pairs with Jaccard and shared topics (case-insensitive)", () => {
    const pairs = candidatePairs({ repos });
    const jz = pairs.find(
      (p) => p.source === "pmndrs/jotai" && p.target === "pmndrs/zustand",
    );
    expect(jz?.signals).toEqual({
      topic: 2 / 3,
      sharedTopics: ["react", "state"],
      owner: true,
    });
    const rz = pairs.find(
      (p) => p.source === "facebook/react" && p.target === "pmndrs/zustand",
    );
    expect(rz?.signals).toEqual({ topic: 1 / 4, sharedTopics: ["react"] });
  });

  it("adds owner pairs case-insensitively even without topics", () => {
    const pairs = candidatePairs({ repos });
    const fb = pairs.find(
      (p) => p.source === "Facebook/jest" && p.target === "facebook/react",
    );
    expect(fb?.signals).toEqual({ owner: true });
  });

  it("adds undirected mentions and ignores self/unknown targets", () => {
    const pairs = candidatePairs({
      repos,
      mentions: new Map([
        ["pmndrs/zustand", ["facebook/react", "pmndrs/zustand", "x/unknown"]],
        ["facebook/react", ["pmndrs/zustand"]],
        ["not/starred", ["lone/repo"]],
      ]),
    });
    const rz = pairs.find(
      (p) => p.source === "facebook/react" && p.target === "pmndrs/zustand",
    );
    expect(rz?.signals.mention).toBe(true);
    expect(pairs.some((p) => p.target === "lone/repo")).toBe(false);
    expect(pairs.some((p) => p.source === p.target)).toBe(false);
  });

  it("emits each pair once, source < target, sorted by (source, target)", () => {
    const pairs = candidatePairs({ repos });
    for (const p of pairs) expect(p.source < p.target).toBe(true);
    const keys = pairs.map((p) => `${p.source} ${p.target}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });

  it("produces no pair for repos without any shared signal", () => {
    const pairs = candidatePairs({ repos });
    expect(
      pairs.some((p) => p.source === "lone/repo" || p.target === "lone/repo"),
    ).toBe(false);
  });

  it("returns [] for empty input", () => {
    expect(candidatePairs({ repos: [] })).toEqual([]);
  });

  it("writes signal keys in schema order", () => {
    const pairs = candidatePairs({
      repos,
      mentions: new Map([["pmndrs/zustand", ["pmndrs/jotai"]]]),
    });
    const jz = pairs.find((p) => p.source === "pmndrs/jotai")!;
    expect(Object.keys(jz.signals)).toEqual([
      "topic",
      "sharedTopics",
      "mention",
      "owner",
    ]);
  });
});

describe("orderSignals", () => {
  it("drops undefined keys and sorts the rest", () => {
    expect(
      Object.keys(orderSignals({ owner: true, semantic: 0.5, topic: 0.1 })),
    ).toEqual(["semantic", "topic", "owner"]);
  });
});
