// Per-node metrics (FR-26): degree, weighted degree, betweenness centrality
// and bridge score (T2.5, T4.1).

import { UndirectedGraph } from "graphology";
import betweennessCentrality from "graphology-metrics/centrality/betweenness";
import type { Attributes } from "graphology-types";

export interface DegreeMetrics {
  degree: number;
  weightedDegree: number;
}

/** Degree and weighted degree for every node in `nodes` (0 for isolates). */
export function degreeMetrics(
  nodes: readonly string[],
  edges: readonly { source: string; target: string; weight: number }[],
): Map<string, DegreeMetrics> {
  const out = new Map<string, DegreeMetrics>(
    nodes.map((id) => [id, { degree: 0, weightedDegree: 0 }]),
  );
  for (const e of edges) {
    for (const id of [e.source, e.target]) {
      const m = out.get(id);
      if (!m) throw new Error(`edge endpoint ${id} is not a node`);
      m.degree += 1;
      m.weightedDegree += e.weight;
    }
  }
  return out;
}

export interface BridgeMetrics {
  betweenness: number;
  bridgeScore: number;
}

/** Shortest-path length of an edge: strong similarity = short hop (T4.1). */
export function edgeDistance(weight: number): number {
  return Math.max(1 - weight, 0) + 1e-6;
}

/**
 * Normalised betweenness centrality (weighted shortest paths, edge distance
 * `1 − w + 1e-6`) and bridge score (number of distinct real clusters among a
 * node's neighbours; "Unclustered" is ignored) for every node in `nodes`.
 * Values are raw here; `serialize.ts` rounds them.
 *
 * Deterministic: nodes are inserted in the given order, edges in the given
 * order, and Brandes' algorithm has no randomness.
 */
export function bridgeMetrics(
  nodes: readonly string[],
  edges: readonly { source: string; target: string; weight: number }[],
  clusterOf: (id: string) => number,
  unclusteredId: number,
): Map<string, BridgeMetrics> {
  const graph = new UndirectedGraph<Attributes, { distance: number }>();
  for (const id of nodes) graph.addNode(id);
  for (const e of edges) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) {
      throw new Error(`edge ${e.source} — ${e.target} has an unknown endpoint`);
    }
    graph.mergeEdge(e.source, e.target, { distance: edgeDistance(e.weight) });
  }
  const centrality = betweennessCentrality(graph, {
    getEdgeWeight: "distance",
    normalized: true,
  });

  const out = new Map<string, BridgeMetrics>();
  for (const id of nodes) {
    const clusters = new Set<number>();
    graph.forEachNeighbor(id, (n) => {
      const c = clusterOf(n);
      if (c !== unclusteredId) clusters.add(c);
    });
    out.set(id, {
      betweenness: centrality[id] ?? 0,
      bridgeScore: clusters.size,
    });
  }
  return out;
}
