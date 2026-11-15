import type { RepoNode } from "@/lib/graph-schema";
import type { RepoGraph } from "@/lib/load-graph";
import { filtersActive, matchesFilters, type Filters } from "@/lib/store";

// Random walk (FR-65, T4.10): pick the next node to visit. Pure apart from
// `random`, so the choice can be reasoned about without the store or canvas.

export interface WalkStepInput {
  graph: RepoGraph;
  repoById: ReadonlyMap<string, RepoNode>;
  filters: Filters;
  /** Current node; null starts the walk at a random repo. */
  current: string | null;
  /** Node the walk came from; avoided when another neighbour exists. */
  previous: string | null;
  /** Uniform [0, 1) source; defaults to Math.random. */
  random?: () => number;
}

/**
 * Weighted-random neighbour of `current`: each neighbour's chance is the
 * edge weight (summed over parallel edges). Repos that fail the active
 * filters are skipped. Returns null when there is nowhere to go.
 */
export function pickWalkStep({
  graph,
  repoById,
  filters,
  current,
  previous,
  random = Math.random,
}: WalkStepInput): string | null {
  const active = filtersActive(filters);
  const allowed = (id: string) => {
    if (!active) return true;
    const repo = repoById.get(id);
    return repo !== undefined && matchesFilters(repo, filters);
  };

  if (current === null || !graph.hasNode(current)) {
    const pool = graph.filterNodes((id) => allowed(id));
    return pool[Math.floor(random() * pool.length)] ?? null;
  }

  const weights = new Map<string, number>();
  graph.forEachEdge(current, (_edge, attrs, source, target) => {
    const other = source === current ? target : source;
    if (other === current || !allowed(other)) return;
    // Floor keeps zero-weight edges reachable when they are the only ones.
    const w = Math.max(attrs.weight, 1e-6);
    weights.set(other, (weights.get(other) ?? 0) + w);
  });
  if (weights.size > 1 && previous !== null) weights.delete(previous);
  return weightedChoice(weights, random);
}

function weightedChoice(
  weights: ReadonlyMap<string, number>,
  random: () => number,
): string | null {
  let total = 0;
  for (const w of weights.values()) total += w;
  if (total <= 0) return null;
  let r = random() * total;
  let last: string | null = null;
  for (const [id, w] of weights) {
    last = id;
    r -= w;
    if (r < 0) return id;
  }
  return last; // float rounding at the top end
}
