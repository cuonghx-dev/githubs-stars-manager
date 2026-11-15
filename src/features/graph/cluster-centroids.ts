import type { Cluster, RepoNode } from "@/lib/graph-schema";

// Cluster centroids for the label overlay (FR-32). Pure so it stays testable
// without WebGL.

/** Camera ratio at or above which cluster labels show (1 = fit-to-graph). */
export const CLUSTER_LABEL_MIN_RATIO = 0.5;

export interface ClusterCentroid {
  id: number;
  label: string;
  color: string;
  size: number;
  x: number;
  y: number;
}

/**
 * Mean position of each cluster's members, in graph coordinates. Skips the
 * "Unclustered" bucket (id -1), clusters without a label and clusters with no
 * member nodes. Sorted by size, largest first, so big clusters paint on top.
 */
export function clusterCentroids(
  clusters: readonly Cluster[],
  nodes: readonly Pick<RepoNode, "cluster" | "x" | "y">[],
): ClusterCentroid[] {
  const sums = new Map<number, { x: number; y: number; n: number }>();
  for (const node of nodes) {
    if (node.cluster < 0) continue;
    const s = sums.get(node.cluster) ?? { x: 0, y: 0, n: 0 };
    s.x += node.x;
    s.y += node.y;
    s.n += 1;
    sums.set(node.cluster, s);
  }

  const out: ClusterCentroid[] = [];
  for (const cluster of clusters) {
    const s = sums.get(cluster.id);
    if (cluster.id < 0 || !s || cluster.label.trim() === "") continue;
    out.push({
      id: cluster.id,
      label: cluster.label,
      color: cluster.color,
      size: s.n,
      x: s.x / s.n,
      y: s.y / s.n,
    });
  }
  return out.sort((a, b) => b.size - a.size || a.id - b.id);
}
