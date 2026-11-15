import { create } from "zustand";
import type { RepoNode } from "@/lib/graph-schema";
import { readThemePreference, writeThemePreference } from "@/lib/theme";

// App-wide UI state (T3.2). React components subscribe with selectors; the
// sigma canvas never re-renders from it: GraphCanvas mirrors the slices it
// needs into refs via `useAppStore.subscribe` and calls `sigma.refresh()`.
//
// Scope: selection, hover, filters, active view, theme preference and the
// "random walk" history. Later M3 tasks fill in behaviour on top of this:
// focus mode (T3.3), filters UI (T3.7), cluster view (T3.8), theme (T3.9),
// path finder (T4.6).

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
  /**
   * Latest "move the camera to this node" request (search, T3.6). `seq`
   * changes on every request so picking the same node twice re-centres.
   */
  centerRequest: { node: string; seq: number } | null;
  /**
   * Latest "fit the camera to these nodes" request (cluster overview, T3.8).
   * `seq` changes on every request so the same set can be refitted.
   */
  fitRequest: { nodes: readonly string[]; seq: number } | null;
  /** Bumped to ask the canvas to fit the whole graph (`f`, T3.10). */
  fitGraphSeq: number;
  /** Bumped to ask the search box to take focus (`/`, T3.10). */
  focusSearchSeq: number;
  /** Whether the keyboard shortcut dialog is open (`?`, T3.10). */
  shortcutsOpen: boolean;
  /** Path finder ends (T4.6); kept while switching views. */
  pathFrom: string | null;
  pathTo: string | null;
  /**
   * Node ids of the current path, ends included; null when there is none.
   * The canvas highlights it only while the Path view is open.
   */
  pathNodes: readonly string[] | null;

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
  /** Ask the canvas to animate the camera to a node. */
  centerOn: (node: string) => void;
  /** Ask the canvas to animate the camera so these nodes fill the view. */
  fitNodes: (nodes: readonly string[]) => void;
  /** Ask the canvas to animate the camera back to the whole graph. */
  fitGraph: () => void;
  /** Ask the search box to take focus. */
  focusSearch: () => void;
  setShortcutsOpen: (open: boolean) => void;
  setPathEnds: (patch: { from?: string | null; to?: string | null }) => void;
  setPathNodes: (nodes: readonly string[] | null) => void;
}

export const useAppStore = create<AppState>()((set, get) => ({
  selectedNode: null,
  hoveredNode: null,
  filters: EMPTY_FILTERS,
  view: "graph",
  theme: readThemePreference(),
  walkHistory: [],
  centerRequest: null,
  fitRequest: null,
  fitGraphSeq: 0,
  focusSearchSeq: 0,
  shortcutsOpen: false,
  pathFrom: null,
  pathTo: null,
  pathNodes: null,

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
  setTheme: (theme) => {
    writeThemePreference(theme);
    set({ theme });
  },
  walkBack: () =>
    set((s) => {
      if (s.walkHistory.length < 2) return {};
      const walkHistory = s.walkHistory.slice(0, -1);
      return { walkHistory, selectedNode: walkHistory.at(-1) ?? null };
    }),
  clearWalk: () => set({ walkHistory: [] }),
  centerOn: (node) =>
    set((s) => ({
      centerRequest: { node, seq: (s.centerRequest?.seq ?? 0) + 1 },
    })),
  fitNodes: (nodes) =>
    set((s) => ({
      fitRequest: { nodes, seq: (s.fitRequest?.seq ?? 0) + 1 },
    })),
  fitGraph: () => set((s) => ({ fitGraphSeq: s.fitGraphSeq + 1 })),
  focusSearch: () => set((s) => ({ focusSearchSeq: s.focusSearchSeq + 1 })),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setPathEnds: ({ from, to }) =>
    set((s) => ({
      pathFrom: from === undefined ? s.pathFrom : from,
      pathTo: to === undefined ? s.pathTo : to,
    })),
  setPathNodes: (pathNodes) => set({ pathNodes }),
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
