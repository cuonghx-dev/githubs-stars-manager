import type { ConceptNode, RepoNode } from "@/lib/graph-schema";

// Concept layer placement (FR-73, T5.7). Each concept node sits at the
// centroid of the repos it links to, in graph coordinates. Pure so it stays
// testable without WebGL.

export interface PlacedConcept {
  id: string;
  label: string;
  /** Linked repo ids that exist in the graph. */
  repos: string[];
  x: number;
  y: number;
}

/**
 * Centroid of each concept's linked repos. Repo ids missing from `nodes` are
 * ignored; concepts with no remaining repo are dropped. Sorted by repo count,
 * largest first, then by id, so the DOM order is stable.
 */
export function placeConcepts(
  concepts: readonly ConceptNode[],
  nodes: readonly Pick<RepoNode, "id" | "x" | "y">[],
): PlacedConcept[] {
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const out: PlacedConcept[] = [];
  for (const concept of concepts) {
    let x = 0;
    let y = 0;
    const repos: string[] = [];
    for (const id of concept.repos) {
      const node = pos.get(id);
      if (!node) continue;
      x += node.x;
      y += node.y;
      repos.push(id);
    }
    if (repos.length === 0) continue;
    out.push({
      id: concept.id,
      label: concept.label,
      repos,
      x: x / repos.length,
      y: y / repos.length,
    });
  }
  return out.sort(
    (a, b) =>
      b.repos.length - a.repos.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
