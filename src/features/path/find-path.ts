import { bidirectional } from "graphology-shortest-path/dijkstra";
import { edgeReason } from "@/features/detail/reasons";
import type { RepoEdge, RepoNode } from "@/lib/graph-schema";
import type { EdgeAttributes, RepoGraph } from "@/lib/load-graph";

// Path finder (FR-61, T4.6): weighted shortest path between two repos and the
// step list shown beside the canvas. Pure so it stays testable without React.

/** Hop cost: a strong similarity is a short hop (same rule as T4.1). */
export function pathCost(weight: number): number {
  return Math.max(1 - weight, 0) + 1e-6;
}

/**
 * Node ids of the cheapest path from `from` to `to` (both included), or null
 * when either end is missing or the two are not connected.
 */
export function findPath(
  graph: RepoGraph,
  from: string,
  to: string,
): string[] | null {
  if (!graph.hasNode(from) || !graph.hasNode(to)) return null;
  const path = bidirectional(graph, from, to, (_edge, attrs: EdgeAttributes) =>
    pathCost(attrs.weight),
  ) as string[] | null;
  return path && path.length > 0 ? path : null;
}

export interface PathStep {
  repo: RepoNode;
  /** Link from the previous step; absent on the first step. */
  link?: { weight: number; reason: string };
}

/** Order-independent key for an undirected edge. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

/** Edge lookup by endpoint pair, built once per graph. */
export function indexEdges(
  edges: readonly RepoEdge[],
): ReadonlyMap<string, RepoEdge> {
  return new Map(edges.map((e) => [pairKey(e.source, e.target), e]));
}

/** Steps for a node path, each with the reason it links to the previous. */
export function pathSteps(
  path: readonly string[],
  repoById: ReadonlyMap<string, RepoNode>,
  edgeByPair: ReadonlyMap<string, RepoEdge>,
): PathStep[] {
  const steps: PathStep[] = [];
  path.forEach((id, i) => {
    const repo = repoById.get(id);
    if (!repo) return;
    const prev = i > 0 ? path[i - 1] : undefined;
    const edge =
      prev === undefined ? undefined : edgeByPair.get(pairKey(prev, id));
    steps.push(
      edge
        ? {
            repo,
            link: { weight: edge.weight, reason: edgeReason(edge.signals) },
          }
        : { repo },
    );
  });
  return steps;
}
