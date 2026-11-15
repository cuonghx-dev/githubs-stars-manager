import type { Cluster } from "@/lib/graph-schema";

// Pure helpers for the repo detail panel (T3.4, FR-40/FR-41/FR-43). Kept out
// of the component so they can be unit-tested without a DOM.

/** Compact star / fork count, e.g. 230000 → "230K", 1234 → "1.2K". */
export function formatCount(n: number, locale = "en"): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/** Calendar date for an ISO timestamp, e.g. "Jan 2, 2020" (UTC). */
export function formatDate(iso: string, locale = "en"): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(ms);
}

/**
 * Safe link target for a repo homepage. GitHub stores whatever the owner
 * typed, so a bare host ("react.dev") gets `https://` and anything that is not
 * http(s) (e.g. `javascript:`) is dropped.
 */
export function homepageHref(homepage: string | undefined): string | null {
  const raw = homepage?.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Host shown as the homepage link text, e.g. "react.dev". */
export function homepageLabel(href: string): string {
  const url = new URL(href);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `${url.host.replace(/^www\./, "")}${path}`;
}

/** Cluster for a repo; falls back to a grey "Unclustered" entry. */
export function findCluster(clusters: readonly Cluster[], id: number): Cluster {
  return (
    clusters.find((c) => c.id === id) ?? {
      id,
      label: id === -1 ? "Unclustered" : `Cluster ${id}`,
      color: "#9ca3af",
      size: 0,
    }
  );
}

/** Whether the cluster filter is narrowed to exactly this cluster (FR-43). */
export function isOnlyCluster(
  filterClusters: readonly number[],
  id: number,
): boolean {
  return filterClusters.length === 1 && filterClusters[0] === id;
}

/**
 * Cluster filter after clicking a cluster chip (FR-43): filter to that cluster,
 * or clear the cluster filter when it is already the only one.
 */
export function toggleClusterFilter(
  filterClusters: readonly number[],
  id: number,
): number[] {
  return isOnlyCluster(filterClusters, id) ? [] : [id];
}
