import type { EdgeSignals, RepoEdge, RepoNode } from "@/lib/graph-schema";

// "Similar repos" (FR-42, T3.5): a node's neighbours sorted by edge weight,
// each with a short reason built from the edge's signal breakdown (FR-23).

/** Max shared topics named in a reason before "+N". */
const MAX_TOPICS = 3;

export interface SimilarRepo {
  repo: RepoNode;
  weight: number;
  reason: string;
}

/** Neighbour lists keyed by repo id, built once per graph. */
export type SimilarIndex = ReadonlyMap<string, readonly SimilarRepo[]>;

/**
 * Human-readable reason for an edge, e.g.
 * "README similarity 0.78 · shared topics: react, state · mentions".
 * Falls back to "related" when no signal is set.
 */
export function edgeReason(signals: EdgeSignals): string {
  const parts: string[] = [];
  if (signals.manual) parts.push(signals.manual.replace(/-/g, " "));
  if (signals.semantic !== undefined) {
    parts.push(`README similarity ${signals.semantic.toFixed(2)}`);
  }
  const topics = signals.sharedTopics ?? [];
  if (topics.length > 0) {
    const shown = topics.slice(0, MAX_TOPICS).join(", ");
    const more = topics.length - MAX_TOPICS;
    parts.push(`shared topics: ${shown}${more > 0 ? ` +${more}` : ""}`);
  } else if (signals.topic !== undefined && signals.topic > 0) {
    parts.push(`topic overlap ${signals.topic.toFixed(2)}`);
  }
  if (signals.mention) parts.push("mentions");
  if (signals.dependency) parts.push("dependency");
  if (signals.owner) parts.push("same owner");
  return parts.length > 0 ? parts.join(" · ") : "related";
}

/**
 * Build every node's neighbour list, sorted by weight (desc), then id for a
 * stable order. Edges to unknown nodes are skipped.
 */
export function buildSimilarIndex(
  nodes: readonly RepoNode[],
  edges: readonly RepoEdge[],
): SimilarIndex {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const index = new Map<string, SimilarRepo[]>();
  const push = (from: string, to: RepoNode, edge: RepoEdge, reason: string) => {
    let list = index.get(from);
    if (!list) index.set(from, (list = []));
    list.push({ repo: to, weight: edge.weight, reason });
  };
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target || source === target) continue;
    const reason = edgeReason(edge.signals);
    push(source.id, target, edge, reason);
    push(target.id, source, edge, reason);
  }
  for (const list of index.values()) {
    list.sort(
      (a, b) => b.weight - a.weight || a.repo.id.localeCompare(b.repo.id),
    );
  }
  return index;
}
