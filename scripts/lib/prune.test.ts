import { describe, expect, it } from "vitest";
import { pruneEdges, type WeightedEdge } from "./prune.ts";

const e = (
  source: string,
  target: string,
  weight: number,
  forced = false,
): WeightedEdge => ({ source, target, weight, forced });

const pairs = (edges: WeightedEdge[]) =>
  edges.map((x) => `${x.source}-${x.target}`);

describe("pruneEdges", () => {
  it("keeps an edge in the top-k of either endpoint", () => {
    // Hub "h" has 3 edges, k = 1: only its best survives from h's side, but
    // "c" and "b" keep their only edge as their own top-1.
    const edges = [e("a", "h", 0.9), e("b", "h", 0.5), e("c", "h", 0.4)];
    expect(pairs(pruneEdges(edges, { k: 1, minWeight: 0 }))).toEqual([
      "a-h",
      "b-h",
      "c-h",
    ]);
  });

  it("drops an edge outside the top-k of both endpoints", () => {
    const edges = [
      e("a", "b", 0.9),
      e("a", "c", 0.8),
      e("b", "c", 0.7),
      e("c", "d", 0.95),
      e("b", "d", 0.96),
    ];
    // k = 1: a→ab, b→bd, c→cd, d→bd. ac and bc are in nobody's top-1.
    expect(pairs(pruneEdges(edges, { k: 1, minWeight: 0 }))).toEqual([
      "a-b",
      "c-d",
      "b-d",
    ]);
  });

  it("requires weight >= minWeight for non-forced edges", () => {
    const edges = [e("a", "b", 0.15), e("a", "c", 0.149)];
    expect(pairs(pruneEdges(edges, { k: 6, minWeight: 0.15 }))).toEqual([
      "a-b",
    ]);
  });

  it("always keeps forced edges, even below threshold and outside top-k", () => {
    const edges = [
      e("a", "b", 0.9),
      e("a", "c", 0.8),
      e("a", "d", 0.01, true),
      e("b", "d", 0.9),
    ];
    const kept = pruneEdges(edges, { k: 1, minWeight: 0.5 });
    expect(pairs(kept)).toContain("a-d");
  });

  it("forced edges count in the ranking", () => {
    // a's top-1 is the forced edge, so a-c only survives via c... which has
    // a better edge c-d, so a-c is dropped.
    const edges = [e("a", "b", 0.9, true), e("a", "c", 0.6), e("c", "d", 0.7)];
    expect(pairs(pruneEdges(edges, { k: 1, minWeight: 0 }))).toEqual([
      "a-b",
      "c-d",
    ]);
  });

  it("breaks weight ties by the other endpoint's id", () => {
    const edges = [e("h", "z", 0.5), e("h", "y", 0.5), e("a", "h", 0.5)];
    // For h with k=1: tie → smallest other id "a". y and z keep their edges
    // as their own top-1, so check with an extra better edge for y and z.
    const more = [...edges, e("y", "q", 0.9), e("z", "q", 0.9)];
    expect(pairs(pruneEdges(more, { k: 1, minWeight: 0 }))).toEqual([
      "a-h",
      "y-q",
      "z-q",
    ]);
  });

  it("is independent of input order (apart from output order)", () => {
    const edges = [
      e("a", "b", 0.3),
      e("a", "c", 0.3),
      e("b", "c", 0.6),
      e("c", "d", 0.2),
      e("a", "d", 0.4),
    ];
    const opts = { k: 1, minWeight: 0 };
    const forward = pairs(pruneEdges(edges, opts)).sort();
    const backward = pairs(pruneEdges([...edges].reverse(), opts)).sort();
    expect(backward).toEqual(forward);
  });

  it("k = 0 keeps only forced edges; rejects bad k", () => {
    const edges = [e("a", "b", 1), e("a", "c", 0.1, true)];
    expect(pairs(pruneEdges(edges, { k: 0, minWeight: 0 }))).toEqual(["a-c"]);
    expect(() => pruneEdges(edges, { k: -1, minWeight: 0 })).toThrow();
    expect(() => pruneEdges(edges, { k: 1.5, minWeight: 0 })).toThrow();
  });

  it("keeps at most k non-forced edges per node in total ≤ k × n", () => {
    const nodes = Array.from(
      { length: 20 },
      (_, i) => `n${String(i).padStart(2, "0")}`,
    );
    const edges: WeightedEdge[] = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        edges.push(e(nodes[i]!, nodes[j]!, ((i * 7 + j * 13) % 17) / 17));
      }
    }
    const k = 3;
    const kept = pruneEdges(edges, { k, minWeight: 0 });
    expect(kept.length).toBeLessThanOrEqual(k * nodes.length);
    expect(kept.length).toBeGreaterThan(0);
  });
});
