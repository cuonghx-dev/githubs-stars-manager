import type { Cluster, RepoNode } from "@/lib/graph-schema";

// Per-cluster stats for the cluster overview (FR-66, T3.8). Pure so it stays
// testable without React.

/** Languages listed per cluster. */
const TOP_LANGUAGES = 3;
/** Repos listed per cluster. */
const TOP_REPOS = 5;

export interface ClusterSummary {
  id: number;
  label: string;
  color: string;
  size: number;
  /** Most common primary languages, most frequent first. */
  languages: { name: string; count: number }[];
  /** Highest-starred members, most stars first. */
  topRepos: RepoNode[];
  memberIds: string[];
}

/**
 * Summaries for every cluster with at least one member, largest first; the
 * "Unclustered" bucket (id -1) goes last.
 */
export function summarizeClusters(
  clusters: readonly Cluster[],
  nodes: readonly RepoNode[],
): ClusterSummary[] {
  const members = new Map<number, RepoNode[]>();
  for (const node of nodes) {
    const list = members.get(node.cluster);
    if (list) list.push(node);
    else members.set(node.cluster, [node]);
  }

  const known = new Map(clusters.map((c) => [c.id, c]));
  const out: ClusterSummary[] = [];
  for (const [id, repos] of members) {
    const cluster = known.get(id);
    const languageCounts = new Map<string, number>();
    for (const repo of repos) {
      if (!repo.language) continue;
      languageCounts.set(
        repo.language,
        (languageCounts.get(repo.language) ?? 0) + 1,
      );
    }
    out.push({
      id,
      label:
        cluster?.label.trim() ||
        (id < 0 ? "Unclustered" : `Cluster ${String(id)}`),
      color: cluster?.color ?? "#a3a3a3",
      size: repos.length,
      languages: [...languageCounts]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, TOP_LANGUAGES),
      topRepos: [...repos]
        .sort((a, b) => b.stars - a.stars || a.id.localeCompare(b.id))
        .slice(0, TOP_REPOS),
      memberIds: repos.map((r) => r.id),
    });
  }
  return out.sort(
    (a, b) =>
      Number(a.id < 0) - Number(b.id < 0) || b.size - a.size || a.id - b.id,
  );
}
