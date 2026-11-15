import type { Cluster, RepoEdge, RepoNode } from "@/lib/graph-schema";

// Bridges view ranking (FR-60, T4.5). Pure so it stays testable without React.
//
// `metrics.betweenness` and `metrics.bridgeScore` come from build-graph
// (T4.1). A graph.json built before T4.1 lacks them, so the bridge score is
// always recomputed here from the edges (distinct real neighbour clusters,
// same rule as scripts/lib/metrics.ts) and betweenness falls back to 0.

/** Rows listed in the view. */
export const TOP_BRIDGES = 20;

/** Cluster id of the "Unclustered" bucket; never counted as a bridge target. */
const UNCLUSTERED = -1;

export type BridgeSort = "betweenness" | "bridgeScore";

export interface ConnectedCluster {
  id: number;
  label: string;
  color: string;
  /** Edges from the bridge node into this cluster. */
  links: number;
  /** True for the bridge node's own cluster. */
  own: boolean;
}

export interface BridgeRow {
  repo: RepoNode;
  betweenness: number;
  bridgeScore: number;
  /** Real clusters among the node's neighbours: own first, then most links. */
  clusters: ConnectedCluster[];
}

/** True when the graph carries precomputed betweenness for any node. */
export function hasBetweenness(nodes: readonly RepoNode[]): boolean {
  return nodes.some((n) => n.metrics.betweenness !== undefined);
}

/**
 * Top `limit` nodes by `sort`, ties broken by the other metric, then by
 * stars and id so the order is stable. Nodes with no cross-cluster reach
 * (bridge score 0 and betweenness 0) are left out.
 */
export function rankBridges(
  nodes: readonly RepoNode[],
  edges: readonly RepoEdge[],
  clusters: readonly Cluster[],
  sort: BridgeSort,
  limit = TOP_BRIDGES,
): BridgeRow[] {
  const clusterOf = new Map(nodes.map((n) => [n.id, n.cluster]));
  const known = new Map(clusters.map((c) => [c.id, c]));

  // node id -> neighbour cluster id -> link count
  const reach = new Map<string, Map<number, number>>();
  const addLink = (from: string, to: string) => {
    const c = clusterOf.get(to);
    if (c === undefined || c === UNCLUSTERED) return;
    let counts = reach.get(from);
    if (!counts) {
      counts = new Map();
      reach.set(from, counts);
    }
    counts.set(c, (counts.get(c) ?? 0) + 1);
  };
  for (const e of edges) {
    if (e.source === e.target) continue;
    addLink(e.source, e.target);
    addLink(e.target, e.source);
  }

  const rows: BridgeRow[] = [];
  for (const repo of nodes) {
    const counts = reach.get(repo.id) ?? new Map<number, number>();
    const betweenness = repo.metrics.betweenness ?? 0;
    const bridgeScore = counts.size;
    if (bridgeScore === 0 && betweenness === 0) continue;
    rows.push({
      repo,
      betweenness,
      bridgeScore,
      clusters: [...counts]
        .map(([id, links]) => {
          const cluster = known.get(id);
          return {
            id,
            label: cluster?.label.trim() || `Cluster ${String(id)}`,
            color: cluster?.color ?? "#a3a3a3",
            links,
            own: id === repo.cluster,
          };
        })
        .sort(
          (a, b) =>
            Number(b.own) - Number(a.own) || b.links - a.links || a.id - b.id,
        ),
    });
  }

  const primary = (r: BridgeRow) =>
    sort === "betweenness" ? r.betweenness : r.bridgeScore;
  const secondary = (r: BridgeRow) =>
    sort === "betweenness" ? r.bridgeScore : r.betweenness;
  return rows
    .sort(
      (a, b) =>
        primary(b) - primary(a) ||
        secondary(b) - secondary(a) ||
        b.repo.stars - a.repo.stars ||
        a.repo.id.localeCompare(b.repo.id),
    )
    .slice(0, limit);
}
