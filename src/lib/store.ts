import { create } from "zustand";
import type { RepoNode } from "@/lib/graph-schema";

// App-wide UI state (T3.2). React components subscribe with selectors; the
// sigma canvas never re-renders from it: GraphCanvas mirrors the slices it
// needs into refs via `useAppStore.subscribe` and calls `sigma.refresh()`.
//
// Scope: selection, hover, filters, active view, theme preference and the
// "random walk" history. Later M3 tasks fill in behaviour on top of this:
// focus mode (T3.3), filters UI (T3.7), cluster view (T3.8), theme (T3.9).

export type ViewId =
  "graph" | "clusters" | "bridges" | "forgotten" | "dupes" | "path";

export type ThemePreference = "system" | "light" | "dark";

/** Archived repos: show all, hide archived, or show only archived (FR-51). */
export type ArchivedFilter = "include" | "exclude" | "only";

/** How nodes that fail the filters are drawn (FR-51). */
export type FilterMode = "hide" | "fade";

export interface Filters {
  /** Primary languages to keep; empty = any. */
  languages: readonly string[];
  /** Cluster ids to keep; empty = any. */
  clusters: readonly number[];
  archived: ArchivedFilter;
  /** Inclusive ISO date bounds on `starredAt`; null = open. */
  starredFrom: string | null;
  starredTo: string | null;
  mode: FilterMode;
}

export const EMPTY_FILTERS: Filters = {
  languages: [],
  clusters: [],
  archived: "include",
  starredFrom: null,
  starredTo: null,
  mode: "fade",
};

/** Max nodes kept in the walk history (back navigation). */
export const WALK_HISTORY_LIMIT = 50;

export interface AppState {
  selectedNode: string | null;
  hoveredNode: string | null;
  filters: Filters;
  view: ViewId;
  theme: ThemePreference;
  /** Nodes visited by selection, oldest first; the last one is current. */
  walkHistory: readonly string[];

  /** Select a node (or clear with null); a new node is pushed to the walk. */
  select: (node: string | null) => void;
  /** Toggle: selecting the selected node clears the selection. */
  toggleSelect: (node: string) => void;
  hover: (node: string | null) => void;
  setFilters: (patch: Partial<Filters>) => void;
  clearFilters: () => void;
  setView: (view: ViewId) => void;
  setTheme: (theme: ThemePreference) => void;
  /** Step back in the walk history and select the previous node. */
  walkBack: () => void;
  clearWalk: () => void;
}

export const useAppStore = create<AppState>()((set, get) => ({
  selectedNode: null,
  hoveredNode: null,
  filters: EMPTY_FILTERS,
  view: "graph",
  theme: "system",
  walkHistory: [],

  select: (node) => {
    if (node === get().selectedNode) return;
    if (node === null) {
      set({ selectedNode: null });
      return;
    }
    set((s) => ({
      selectedNode: node,
      walkHistory: pushWalk(s.walkHistory, node),
    }));
  },
  toggleSelect: (node) => {
    get().select(get().selectedNode === node ? null : node);
  },
  hover: (node) => {
    if (node !== get().hoveredNode) set({ hoveredNode: node });
  },
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  clearFilters: () =>
    set((s) => ({ filters: { ...EMPTY_FILTERS, mode: s.filters.mode } })),
  setView: (view) => set({ view }),
  setTheme: (theme) => set({ theme }),
  walkBack: () =>
    set((s) => {
      if (s.walkHistory.length < 2) return {};
      const walkHistory = s.walkHistory.slice(0, -1);
      return { walkHistory, selectedNode: walkHistory.at(-1) ?? null };
    }),
  clearWalk: () => set({ walkHistory: [] }),
}));

function pushWalk(history: readonly string[], node: string): string[] {
  if (history.at(-1) === node) return [...history];
  const next = [...history, node];
  return next.length > WALK_HISTORY_LIMIT
    ? next.slice(next.length - WALK_HISTORY_LIMIT)
    : next;
}

/** True when at least one filter narrows the graph (mode aside). */
export function filtersActive(f: Filters): boolean {
  return (
    f.languages.length > 0 ||
    f.clusters.length > 0 ||
    f.archived !== "include" ||
    f.starredFrom !== null ||
    f.starredTo !== null
  );
}

/** Whether a repo passes the filters (FR-51). */
export function matchesFilters(repo: RepoNode, f: Filters): boolean {
  if (f.languages.length > 0 && !f.languages.includes(repo.language ?? "")) {
    return false;
  }
  if (f.clusters.length > 0 && !f.clusters.includes(repo.cluster)) return false;
  if (f.archived === "exclude" && repo.isArchived) return false;
  if (f.archived === "only" && !repo.isArchived) return false;
  const day = repo.starredAt.slice(0, 10);
  if (f.starredFrom !== null && day < f.starredFrom.slice(0, 10)) return false;
  if (f.starredTo !== null && day > f.starredTo.slice(0, 10)) return false;
  return true;
}
