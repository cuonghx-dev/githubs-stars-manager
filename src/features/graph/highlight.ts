import type { EdgeDisplayData, NodeDisplayData } from "sigma/types";
import type { RepoGraph } from "@/lib/load-graph";

// Hover highlight (FR-33): the hovered node and its direct neighbours keep
// their colour and show labels; everything else fades. Pure helpers so the
// reducers can be unit-tested without WebGL.

export interface Highlight {
  node: string;
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
}

export interface FadeColors {
  node: string;
  edge: string;
}

export function computeHighlight(
  graph: RepoGraph,
  node: string | null,
): Highlight | null {
  if (node === null || !graph.hasNode(node)) return null;
  const nodes = new Set<string>([node, ...graph.neighbors(node)]);
  const edges = new Set<string>(graph.edges(node));
  return { node, nodes, edges };
}

export function nodeHighlightStyle(
  key: string,
  highlight: Highlight | null,
  fade: FadeColors,
): Partial<NodeDisplayData> {
  if (highlight === null) return {};
  if (key === highlight.node) {
    return { highlighted: true, labelVisibility: "visible", depth: "topNodes" };
  }
  if (highlight.nodes.has(key)) {
    return { labelVisibility: "visible", depth: "topNodes" };
  }
  return { color: fade.node, labelVisibility: "hidden" };
}

export function edgeHighlightStyle(
  key: string,
  highlight: Highlight | null,
  fade: FadeColors,
): Partial<EdgeDisplayData> {
  if (highlight === null) return {};
  if (highlight.edges.has(key)) return { depth: "topEdges" };
  return { color: fade.edge };
}
