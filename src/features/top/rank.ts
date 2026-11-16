import type { RepoNode } from "@/lib/graph-schema";

// Top view ranking: the repos most worth a look, by GitHub stars, by links in
// the similarity graph (`metrics.degree`), or by both combined. Pure so it
// stays testable without React.
//
// Stars span five orders of magnitude while degree tops out in the tens, so
// the combined score averages each repo's percentile rank on the two axes
// instead of their raw values: a repo has to be high on both to lead.

/** Rows listed in the view. */
export const TOP_REPOS = 50;

export type TopSort = "score" | "stars" | "links";

export interface TopRow {
  repo: RepoNode;
  stars: number;
  links: number;
  /** Mean of the stars and links percentile ranks, 0..1. */
  score: number;
}

/**
 * Percentile rank of each value: share of the other values strictly below
 * it, with ties sharing the average rank. A single value ranks 1.
 */
function percentiles(values: readonly number[]): number[] {
  const n = values.length;
  if (n <= 1) return values.map(() => 1);
  // value -> [first, last] index in ascending order
  const span = new Map<number, [number, number]>();
  [...values]
    .sort((a, b) => a - b)
    .forEach((v, i) => {
      const s = span.get(v);
      if (s) s[1] = i;
      else span.set(v, [i, i]);
    });
  return values.map((v) => {
    const [first, last] = span.get(v) ?? [0, 0];
    return (first + last) / 2 / (n - 1);
  });
}

/**
 * Top `limit` repos by `sort`, ties broken by the combined score, then stars,
 * links and id so the order is stable.
 */
export function rankTopRepos(
  nodes: readonly RepoNode[],
  sort: TopSort,
  limit = TOP_REPOS,
): TopRow[] {
  const starRanks = percentiles(nodes.map((n) => n.stars));
  const linkRanks = percentiles(nodes.map((n) => n.metrics.degree));
  const rows = nodes.map((repo, i) => ({
    repo,
    stars: repo.stars,
    links: repo.metrics.degree,
    score: ((starRanks[i] ?? 0) + (linkRanks[i] ?? 0)) / 2,
  }));
  const primary = (r: TopRow) =>
    sort === "stars" ? r.stars : sort === "links" ? r.links : r.score;
  return rows
    .sort(
      (a, b) =>
        primary(b) - primary(a) ||
        b.score - a.score ||
        b.stars - a.stars ||
        b.links - a.links ||
        a.repo.id.localeCompare(b.repo.id),
    )
    .slice(0, limit);
}
