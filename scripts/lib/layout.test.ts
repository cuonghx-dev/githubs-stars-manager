import { describe, expect, it } from "vitest";
import { computeLayout } from "./layout.ts";

const opts = { iterations: 100, seed: 42 };
const nodes = ["a/1", "a/2", "a/3", "b/1", "b/2", "z/iso1", "z/iso2", "z/iso3"];
const edges = [
  { source: "a/1", target: "a/2", weight: 0.8 },
  { source: "a/2", target: "a/3", weight: 0.5 },
  { source: "a/1", target: "a/3", weight: 0.4 },
  { source: "b/1", target: "b/2", weight: 0.9 },
  { source: "a/3", target: "b/1", weight: 0.2 },
];

describe("computeLayout", () => {
  it("positions every node with finite coordinates", () => {
    const pos = computeLayout(nodes, edges, opts);
    expect([...pos.keys()].sort()).toEqual([...nodes].sort());
    for (const p of pos.values()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });

  it("is deterministic for a seed and independent of input order", () => {
    const a = computeLayout(nodes, edges, opts);
    const b = computeLayout([...nodes].reverse(), edges, opts);
    expect([...b.entries()].sort()).toEqual([...a.entries()].sort());
    const c = computeLayout(nodes, edges, { ...opts, seed: 7 });
    expect(c.get("a/1")).not.toEqual(a.get("a/1"));
  });

  it("puts isolates evenly on a ring outside the connected layout", () => {
    const pos = computeLayout(nodes, edges, opts);
    const connected = ["a/1", "a/2", "a/3", "b/1", "b/2"].map((id) =>
      pos.get(id)!,
    );
    const cx = connected.reduce((s, p) => s + p.x, 0) / connected.length;
    const cy = connected.reduce((s, p) => s + p.y, 0) / connected.length;
    const dist = (p: { x: number; y: number }) =>
      Math.hypot(p.x - cx, p.y - cy);
    const maxInner = Math.max(...connected.map(dist));
    const ring = ["z/iso1", "z/iso2", "z/iso3"].map((id) => dist(pos.get(id)!));
    for (const r of ring) {
      expect(r).toBeCloseTo(ring[0]!, 6);
      expect(r).toBeGreaterThan(maxInner);
    }
    // First isolate (in id order) sits at angle 0.
    expect(pos.get("z/iso1")!.y).toBeCloseTo(cy, 6);
  });

  it("handles a graph with only isolates or no nodes", () => {
    const pos = computeLayout(["x/1", "x/2"], [], opts);
    expect(pos.get("x/1")).toEqual({ x: 50, y: 0 });
    expect(pos.get("x/2")!.x).toBeCloseTo(-50, 6);
    expect(computeLayout([], [], opts).size).toBe(0);
  });

  it("rejects an edge to an unknown node", () => {
    expect(() =>
      computeLayout(
        ["a/1"],
        [{ source: "a/1", target: "q/q", weight: 1 }],
        opts,
      ),
    ).toThrow(/q\/q/);
  });
});
