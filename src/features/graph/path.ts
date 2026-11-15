import type { EdgeDisplayData, NodeDisplayData } from "sigma/types";
import type { FadeColors } from "@/features/graph/highlight";
import type { RepoGraph } from "@/lib/load-graph";

// Path highlight (FR-61, T4.6): while the Path view shows a route, its nodes
// and edges stay at full colour with labels and everything else fades. Takes
// precedence over focus mode; a hover highlight still wins over it.

export interface PathHighlight {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
}

export function computePathHighlight(
  graph: RepoGraph,
  path: readonly string[] | null,
): PathHighlight | null {
  if (path === null || path.length === 0) return null;
  const nodes = new Set(path.filter((id) => graph.hasNode(id)));
  const edges = new Set<string>();
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a === undefined || b === undefined) continue;
    const edge = graph.hasNode(a) && graph.hasNode(b) ? graph.edge(a, b) : null;
    if (edge) edges.add(edge);
  }
  return { nodes, edges };
}

export function nodePathStyle(
  key: string,
  path: PathHighlight,
  fade: FadeColors,
): Partial<NodeDisplayData> {
  if (path.nodes.has(key)) {
    return { labelVisibility: "visible", depth: "topNodes" };
  }
  return { color: fade.node, labelVisibility: "hidden" };
}

export function edgePathStyle(
  key: string,
  path: PathHighlight,
  fade: FadeColors,
): Partial<EdgeDisplayData> {
  if (path.edges.has(key)) return { depth: "topEdges", size: 3 };
  return { color: fade.edge };
}
