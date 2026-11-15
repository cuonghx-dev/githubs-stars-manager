import { UndirectedGraph } from "graphology";
import { describe, expect, it } from "vitest";
import {
  computeHighlight,
  edgeHighlightStyle,
  nodeHighlightStyle,
} from "@/features/graph/highlight";
import type { RepoGraph } from "@/lib/load-graph";

const fade = { node: "#eee", edge: "#f5f5f5" };

function makeGraph(): RepoGraph {
  const g: RepoGraph = new UndirectedGraph();
  for (const id of ["a/a", "b/b", "c/c", "d/d"]) {
    g.addNode(id, {
      x: 0,
      y: 0,
      size: 1,
      color: "#000",
      label: id,
      archived: false,
    });
  }
  g.addEdgeWithKey("ab", "a/a", "b/b", {
    size: 1,
    weight: 1,
    kind: "similarity",
  });
  g.addEdgeWithKey("bc", "b/b", "c/c", {
    size: 1,
    weight: 1,
    kind: "similarity",
  });
  g.addEdgeWithKey("cd", "c/c", "d/d", {
    size: 1,
    weight: 1,
    kind: "similarity",
  });
  return g;
}

describe("computeHighlight", () => {
  it("returns the node, its direct neighbours and incident edges", () => {
    const h = computeHighlight(makeGraph(), "b/b");
    expect(h).not.toBeNull();
    expect([...h!.nodes].sort()).toEqual(["a/a", "b/b", "c/c"]);
    expect([...h!.edges].sort()).toEqual(["ab", "bc"]);
  });

  it("returns null for no hover or an unknown node", () => {
    expect(computeHighlight(makeGraph(), null)).toBeNull();
    expect(computeHighlight(makeGraph(), "x/x")).toBeNull();
  });
});

describe("highlight styles", () => {
  const h = computeHighlight(makeGraph(), "b/b");

  it("leaves everything untouched when nothing is hovered", () => {
    expect(nodeHighlightStyle("a/a", null, fade)).toEqual({});
    expect(edgeHighlightStyle("ab", null, fade)).toEqual({});
  });

  it("highlights the hovered node and shows neighbour labels", () => {
    expect(nodeHighlightStyle("b/b", h, fade)).toMatchObject({
      highlighted: true,
      labelVisibility: "visible",
    });
    expect(nodeHighlightStyle("a/a", h, fade)).toMatchObject({
      labelVisibility: "visible",
    });
    expect(nodeHighlightStyle("a/a", h, fade).color).toBeUndefined();
  });

  it("fades non-neighbours and their edges", () => {
    expect(nodeHighlightStyle("d/d", h, fade)).toMatchObject({
      color: fade.node,
      labelVisibility: "hidden",
    });
    expect(edgeHighlightStyle("cd", h, fade)).toEqual({ color: fade.edge });
    expect(edgeHighlightStyle("ab", h, fade).color).toBeUndefined();
  });
});
