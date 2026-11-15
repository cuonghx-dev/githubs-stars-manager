import { UndirectedGraph } from "graphology";
import { describe, expect, it } from "vitest";
import {
  computeFocus,
  edgeFocusStyle,
  mixHex,
  nodeFocusStyle,
} from "@/features/graph/focus";
import type { RepoGraph } from "@/lib/load-graph";

const colors = { node: "#ffffff", edge: "#f5f5f5", dimEdge: "#cccccc" };

// a - b - c - d - e, plus b - f (f is 1-hop from b, 2-hop from a)
function makeGraph(): RepoGraph {
  const g: RepoGraph = new UndirectedGraph();
  for (const id of ["a", "b", "c", "d", "e", "f"]) {
    g.addNode(id, {
      x: 0,
      y: 0,
      size: 1,
      color: "#000000",
      label: id,
      archived: false,
    });
  }
  g.addEdgeWithKey("ab", "a", "b", { size: 1, weight: 1, kind: "similarity" });
  g.addEdgeWithKey("bc", "b", "c", { size: 1, weight: 1, kind: "similarity" });
  g.addEdgeWithKey("cd", "c", "d", { size: 1, weight: 1, kind: "similarity" });
  g.addEdgeWithKey("de", "d", "e", { size: 1, weight: 1, kind: "similarity" });
  g.addEdgeWithKey("bf", "b", "f", { size: 1, weight: 1, kind: "similarity" });
  return g;
}

describe("computeFocus", () => {
  it("splits neighbours into 1-hop and 2-hop rings", () => {
    const f = computeFocus(makeGraph(), "c");
    expect(f).not.toBeNull();
    expect([...f!.hop1].sort()).toEqual(["b", "d"]);
    expect([...f!.hop2].sort()).toEqual(["a", "e", "f"]);
  });

  it("keeps the focus node and 1-hop nodes out of the 2-hop ring", () => {
    const g = makeGraph();
    g.addEdgeWithKey("ac", "a", "c", {
      size: 1,
      weight: 1,
      kind: "similarity",
    });
    const f = computeFocus(g, "a");
    expect([...f!.hop1].sort()).toEqual(["b", "c"]);
    expect([...f!.hop2].sort()).toEqual(["d", "f"]);
  });

  it("returns null for no selection or an unknown node", () => {
    expect(computeFocus(makeGraph(), null)).toBeNull();
    expect(computeFocus(makeGraph(), "x")).toBeNull();
  });
});

describe("focus styles", () => {
  const f = computeFocus(makeGraph(), "a");

  it("leaves everything untouched without focus", () => {
    expect(nodeFocusStyle("a", "#000000", null, colors)).toEqual({});
    expect(edgeFocusStyle("a", "b", null, colors)).toEqual({});
  });

  it("keeps the focus node and 1-hop neighbours at full colour", () => {
    expect(nodeFocusStyle("a", "#000000", f, colors)).toEqual({
      labelVisibility: "visible",
      depth: "topNodes",
    });
    expect(nodeFocusStyle("b", "#000000", f, colors).color).toBeUndefined();
  });

  it("dims 2-hop nodes and fades the rest", () => {
    const dim = nodeFocusStyle("c", "#000000", f, colors);
    expect(dim.color).toBe(mixHex("#000000", "#ffffff", 0.55));
    expect(dim.color).not.toBe(colors.node);
    expect(nodeFocusStyle("d", "#000000", f, colors)).toEqual({
      color: colors.node,
      labelVisibility: "hidden",
    });
  });

  it("raises edges at the focus node, dims edges inside the rings, fades the rest", () => {
    expect(edgeFocusStyle("a", "b", f, colors)).toEqual({ depth: "topEdges" });
    expect(edgeFocusStyle("b", "c", f, colors)).toEqual({
      color: colors.dimEdge,
    });
    expect(edgeFocusStyle("c", "d", f, colors)).toEqual({
      color: colors.edge,
    });
  });
});

describe("mixHex", () => {
  it("mixes two hex colours", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("falls back to the second colour for non-hex input", () => {
    expect(mixHex("rgb(0,0,0)", "#ffffff", 0.5)).toBe("#ffffff");
  });
});
