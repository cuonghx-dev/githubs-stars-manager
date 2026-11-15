import config from "../../../config/graph.config";
import type { RepoNode } from "@/lib/graph-schema";

// Forgotten stars (FR-62, T4.7). Pure so it stays testable without React.
//
// A star is "forgotten" when any rule from config/graph.config.ts matches:
// - lonely: starred more than `starredOlderThanDays` ago and degree <= `maxDegree`
// - archived: the repo is archived (when `includeArchived`)
// - stale: the last push is older than `pushedOlderThanDays`

export type ForgottenReason = "lonely" | "archived" | "stale";

export type ForgottenRules = typeof config.forgotten;

export interface ForgottenRow {
  repo: RepoNode;
  /** Matching rules, in a fixed order: lonely, archived, stale. */
  reasons: ForgottenReason[];
  /** Days since the star, or NaN when the date is unparseable. */
  starredDays: number;
  /** Days since the last push, or NaN when the date is unparseable. */
  pushedDays: number;
}

export type ForgottenSortKey =
  "repo" | "starred" | "pushed" | "degree" | "stars" | "reasons";

export interface ForgottenSort {
  key: ForgottenSortKey;
  /** true = ascending. */
  asc: boolean;
}

const DAY_MS = 24 * 3600 * 1000;

function daysSince(iso: string, now: number): number {
  return (now - Date.parse(iso)) / DAY_MS;
}

/** Rules that make `repo` forgotten; empty when none match. */
export function forgottenReasons(
  repo: RepoNode,
  now: number,
  rules: ForgottenRules = config.forgotten,
): ForgottenReason[] {
  const reasons: ForgottenReason[] = [];
  if (
    daysSince(repo.starredAt, now) > rules.starredOlderThanDays &&
    repo.metrics.degree <= rules.maxDegree
  ) {
    reasons.push("lonely");
  }
  if (rules.includeArchived && repo.isArchived) reasons.push("archived");
  if (daysSince(repo.pushedAt, now) > rules.pushedOlderThanDays) {
    reasons.push("stale");
  }
  return reasons;
}

/** Every forgotten repo, unsorted. */
export function findForgotten(
  nodes: readonly RepoNode[],
  now: number,
  rules: ForgottenRules = config.forgotten,
): ForgottenRow[] {
  const rows: ForgottenRow[] = [];
  for (const repo of nodes) {
    const reasons = forgottenReasons(repo, now, rules);
    if (reasons.length === 0) continue;
    rows.push({
      repo,
      reasons,
      starredDays: daysSince(repo.starredAt, now),
      pushedDays: daysSince(repo.pushedAt, now),
    });
  }
  return rows;
}

function sortValue(row: ForgottenRow, key: ForgottenSortKey): number | string {
  switch (key) {
    case "repo":
      return row.repo.id.toLowerCase();
    case "starred":
      return row.starredDays;
    case "pushed":
      return row.pushedDays;
    case "degree":
      return row.repo.metrics.degree;
    case "stars":
      return row.repo.stars;
    case "reasons":
      return row.reasons.length;
  }
}

/** Sorted copy; ties fall back to repo id so the order is stable. */
export function sortForgotten(
  rows: readonly ForgottenRow[],
  sort: ForgottenSort,
): ForgottenRow[] {
  const dir = sort.asc ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    let cmp: number;
    if (typeof va === "number" && typeof vb === "number") {
      const na = Number.isNaN(va);
      const nb = Number.isNaN(vb);
      // NaN (bad dates) always sinks to the bottom, whatever the direction.
      if (na || nb) cmp = na === nb ? 0 : na ? 1 : -1;
      else cmp = (va - vb) * dir;
    } else {
      cmp = String(va).localeCompare(String(vb)) * dir;
    }
    return cmp !== 0 ? cmp : a.repo.id.localeCompare(b.repo.id);
  });
}

/** Default sort: oldest stars first, so the longest-forgotten lead. */
export const DEFAULT_FORGOTTEN_SORT: ForgottenSort = {
  key: "starred",
  asc: false,
};
