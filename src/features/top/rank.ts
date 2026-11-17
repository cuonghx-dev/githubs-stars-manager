import type { RepoNode } from "@/lib/graph-schema";

// Top view ranking: the repos most worth a look, by GitHub stars, by links in
// the similarity graph (`metrics.degree`), or by both combined; also by name
// and by when they were starred. Pure so it stays testable without React.
//
// Stars span five orders of magnitude while degree tops out in the tens, so
// the combined score averages each repo's percentile rank on the two axes
// instead of their raw values: a repo has to be high on both to lead.

export type TopSortKey = "score" | "stars" | "links" | "starred" | "name";

export interface TopSort {
  key: TopSortKey;
  asc: boolean;
}

export const DEFAULT_TOP_SORT: TopSort = { key: "score", asc: false };

/** Rows per page offered by the view. */
export const TOP_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_TOP_PAGE_SIZE = 50;

export interface TopRow {
  repo: RepoNode;
  stars: number;
  links: number;
  /** Mean of the stars and links percentile ranks, 0..1. */
  score: number;
}

/** Sort direction a key starts with: text A→Z, everything else biggest first. */
export function defaultAsc(key: TopSortKey): boolean {
  return key === "name";
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

/** Ascending comparison on the sort key alone. */
function compareKey(a: TopRow, b: TopRow, key: TopSortKey): number {
  switch (key) {
    case "score":
      return a.score - b.score;
    case "stars":
      return a.stars - b.stars;
    case "links":
      return a.links - b.links;
    case "starred":
      return a.repo.starredAt.localeCompare(b.repo.starredAt);
    case "name":
      return a.repo.id.localeCompare(b.repo.id, undefined, {
        sensitivity: "base",
      });
  }
}

/**
 * Every repo ordered by `sort`. Ties are broken by the combined score, then
 * stars, links and id (always best-first / A→Z) so the order is stable
 * whichever direction the key runs.
 */
export function rankTopRepos(
  nodes: readonly RepoNode[],
  sort: TopSort = DEFAULT_TOP_SORT,
): TopRow[] {
  const starRanks = percentiles(nodes.map((n) => n.stars));
  const linkRanks = percentiles(nodes.map((n) => n.metrics.degree));
  const rows = nodes.map((repo, i) => ({
    repo,
    stars: repo.stars,
    links: repo.metrics.degree,
    score: ((starRanks[i] ?? 0) + (linkRanks[i] ?? 0)) / 2,
  }));
  const dir = sort.asc ? 1 : -1;
  return rows.sort(
    (a, b) =>
      dir * compareKey(a, b, sort.key) ||
      b.score - a.score ||
      b.stars - a.stars ||
      b.links - a.links ||
      a.repo.id.localeCompare(b.repo.id),
  );
}

/** Number of pages for `total` rows, at least 1. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Clamp a 0-based page index into range. */
export function clampPage(page: number, total: number, pageSize: number) {
  return Math.min(Math.max(0, page), pageCount(total, pageSize) - 1);
}
