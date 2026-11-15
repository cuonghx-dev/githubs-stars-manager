import {
  EMPTY_FILTERS,
  type ArchivedFilter,
  type FilterMode,
  type Filters,
  type ViewId,
} from "@/lib/store";

// URL state codec (FR-52, T4.11): filters, selection and active view live in
// the query string so a view can be bookmarked or shared. Defaults are left
// out to keep URLs short; unknown params are kept untouched on encode.
//
//   ?view=path&node=owner/repo&lang=Rust&lang=Go&cluster=3&archived=exclude
//    &from=2024-01-01&to=2024-12-31&mode=hide

export interface UrlState {
  view: ViewId;
  selectedNode: string | null;
  filters: Filters;
}

/** Query keys owned by the codec; everything else passes through. */
const KEYS = [
  "view",
  "node",
  "lang",
  "cluster",
  "archived",
  "from",
  "to",
  "mode",
] as const;

const VIEWS: readonly ViewId[] = [
  "graph",
  "clusters",
  "bridges",
  "forgotten",
  "dupes",
  "path",
];
const ARCHIVED: readonly ArchivedFilter[] = ["include", "exclude", "only"];
const MODES: readonly FilterMode[] = ["hide", "fade"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Write `state` into a query string. `base` is the current search string;
 * params the codec does not own are preserved. Returns "" or "?…".
 */
export function encodeUrlState(state: UrlState, base = ""): string {
  const params = new URLSearchParams(base);
  for (const key of KEYS) params.delete(key);

  const { view, selectedNode, filters: f } = state;
  if (view !== "graph") params.set("view", view);
  if (selectedNode !== null) params.set("node", selectedNode);
  for (const lang of f.languages) params.append("lang", lang);
  for (const id of f.clusters) params.append("cluster", String(id));
  if (f.archived !== EMPTY_FILTERS.archived) params.set("archived", f.archived);
  if (f.starredFrom !== null) params.set("from", f.starredFrom.slice(0, 10));
  if (f.starredTo !== null) params.set("to", f.starredTo.slice(0, 10));
  if (f.mode !== EMPTY_FILTERS.mode) params.set("mode", f.mode);

  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

/**
 * Read a query string back into state. Invalid or unknown values fall back
 * to the defaults, so a hand-edited URL never breaks the app.
 */
export function decodeUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);

  const view = pick(params.get("view"), VIEWS) ?? "graph";
  const node = params.get("node");
  const languages = unique(params.getAll("lang").filter((l) => l !== ""));
  const clusters = unique(
    params
      .getAll("cluster")
      .filter((c) => /^\d+$/.test(c))
      .map(Number),
  );
  const archived =
    pick(params.get("archived"), ARCHIVED) ?? EMPTY_FILTERS.archived;
  const mode = pick(params.get("mode"), MODES) ?? EMPTY_FILTERS.mode;

  return {
    view,
    selectedNode: node === null || node === "" ? null : node,
    filters: {
      languages,
      clusters,
      archived,
      starredFrom: day(params.get("from")),
      starredTo: day(params.get("to")),
      mode,
    },
  };
}

function pick<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | null {
  return value !== null && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function day(value: string | null): string | null {
  return value !== null && DAY.test(value) ? value : null;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
