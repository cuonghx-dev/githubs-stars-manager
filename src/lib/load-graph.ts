import { UndirectedGraph } from "graphology";
import {
  parseGraphFile,
  type Cluster,
  type EdgeSignals,
  type GraphFile,
  type RepoEdge,
  type RepoNode,
} from "@/lib/graph-schema";

// Loads `public/graph.json`, validates it against the shared schema and
// builds the graphology instance sigma renders (plan §3.3, FR-30, FR-37).

/** Colour for nodes whose cluster id is not in `clusters` (defensive). */
export const FALLBACK_NODE_COLOR = "#9ca3af";

/** Rendered node radius range in pixels (FR-31). */
export const NODE_SIZE_RANGE = { min: 2, max: 12 } as const;

/** Rendered edge thickness range in pixels; scaled by weight (FR-35). */
export const EDGE_SIZE_RANGE = { min: 0.5, max: 3 } as const;

export interface NodeAttributes {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  /** Archived repos render hollow (FR-36). */
  archived: boolean;
}

/**
 * Edge style class (FR-35). Dependency wins over mention when both signals
 * are set; everything else is a plain similarity edge.
 */
export type EdgeKind = "similarity" | "mention" | "dependency";

export interface EdgeAttributes {
  size: number;
  weight: number;
  kind: EdgeKind;
}

export type RepoGraph = UndirectedGraph<NodeAttributes, EdgeAttributes>;

export interface LoadedGraph {
  data: GraphFile;
  graph: RepoGraph;
  nodesById: ReadonlyMap<string, RepoNode>;
  clustersById: ReadonlyMap<number, Cluster>;
}

export type LoadGraphResult =
  | { status: "ok"; graph: LoadedGraph }
  | { status: "missing"; message: string }
  | { status: "invalid"; message: string }
  | { status: "unsupported-version"; message: string };

/**
 * Log-scaled node size from the star count (FR-31): `log1p(stars)` mapped
 * linearly onto `NODE_SIZE_RANGE`, relative to the most-starred repo.
 */
export function nodeSize(stars: number, maxStars: number): number {
  const { min, max } = NODE_SIZE_RANGE;
  if (maxStars <= 0) return min;
  const t = Math.log1p(Math.max(0, stars)) / Math.log1p(maxStars);
  return min + (max - min) * Math.min(1, t);
}

/** Edge thickness from the combined weight in [0, 1] (FR-35). */
export function edgeSize(weight: number): number {
  const { min, max } = EDGE_SIZE_RANGE;
  return min + (max - min) * Math.min(1, Math.max(0, weight));
}

/** Style class of an edge from its signals (FR-35). */
export function edgeKind(signals: EdgeSignals): EdgeKind {
  if (signals.dependency) return "dependency";
  if (signals.mention) return "mention";
  return "similarity";
}

/** Build the graphology instance and lookup maps from a validated file. */
export function buildRepoGraph(data: GraphFile): LoadedGraph {
  const clustersById = new Map(data.clusters.map((c) => [c.id, c]));
  const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
  const maxStars = data.nodes.reduce((m, n) => Math.max(m, n.stars), 0);

  const graph: RepoGraph = new UndirectedGraph();
  for (const node of data.nodes) {
    graph.addNode(node.id, {
      x: node.x,
      y: node.y,
      size: nodeSize(node.stars, maxStars),
      color: clustersById.get(node.cluster)?.color ?? FALLBACK_NODE_COLOR,
      label: node.id,
      archived: node.isArchived,
    });
  }
  for (const edge of data.edges) addEdge(graph, edge);

  return { data, graph, nodesById, clustersById };
}

// Edges whose endpoints are unknown, self-loops and duplicates are skipped:
// the schema cannot express referential integrity, and graphology throws.
function addEdge(graph: RepoGraph, edge: RepoEdge): void {
  const { source, target, weight, signals } = edge;
  if (source === target) return;
  if (!graph.hasNode(source) || !graph.hasNode(target)) return;
  if (graph.hasEdge(source, target)) return;
  graph.addEdge(source, target, {
    size: edgeSize(weight),
    weight,
    kind: edgeKind(signals),
  });
}

/** Default location of the graph file, relative to Vite's `base` (NFR-7). */
export function graphUrl(baseUrl: string = import.meta.env.BASE_URL): string {
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}graph.json`;
}

export type FetchLike = (
  url: string,
) => Promise<Pick<Response, "ok" | "status" | "text">>;

/**
 * Fetch and validate `graph.json`. Never throws: a missing file, a network
 * error, bad JSON, an unknown `version` or a schema violation all map to a
 * non-ok status the app renders as the empty/error state (FR-37).
 */
export async function loadGraph(
  url: string = graphUrl(),
  fetchFn: FetchLike = (u) => fetch(u, { cache: "no-cache" }),
): Promise<LoadGraphResult> {
  let text: string;
  try {
    const res = await fetchFn(url);
    if (!res.ok) {
      return {
        status: "missing",
        message: `${url} returned HTTP ${res.status}`,
      };
    }
    text = await res.text();
  } catch (err) {
    return {
      status: "missing",
      message: `could not fetch ${url}: ${errorMessage(err)}`,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    // Vite's dev server answers unknown paths with index.html (HTTP 200), so
    // an HTML body means the file is missing rather than corrupt.
    if (/^\s*</.test(text)) {
      return { status: "missing", message: `${url} not found` };
    }
    return {
      status: "invalid",
      message: `graph.json is not valid JSON: ${errorMessage(err)}`,
    };
  }

  const parsed = parseGraphFile(json);
  if (!parsed.ok) return { status: parsed.reason, message: parsed.message };
  return { status: "ok", graph: buildRepoGraph(parsed.data) };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
