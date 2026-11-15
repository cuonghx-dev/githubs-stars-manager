// Community detection (FR-24, NFR-4).
//
// Weighted Louvain (`graphology-communities-louvain`) with the shared seeded
// PRNG and the configured `resolution`. Communities with fewer than
// `minClusterSize` members (isolates included) go to "Unclustered" (-1). The
// rest get ids 0..n-1 by size desc, ties broken by the smallest member id, and
// colours from a fixed colour-blind-safe palette in id order. Same input →
// same ids and colours.
//
// Deterministic: nodes are inserted in sorted id order, edges in the given
// order, and the only randomness comes from `mulberry32(seed)`.

import { UndirectedGraph } from "graphology";
import louvain from "graphology-communities-louvain";
import { mulberry32 } from "./rng.ts";

export const UNCLUSTERED_ID = -1;
export const UNCLUSTERED_LABEL = "Unclustered";
/** Neutral grey that reads in both themes; never used for a real cluster. */
export const UNCLUSTERED_COLOR = "#9ca3af";

/**
 * Colour-blind-safe categorical palette (Okabe-Ito + Paul Tol "bright", minus
 * black, white and greys). Every entry is mid-lightness, so it keeps contrast
 * against both the light and the dark canvas background.
 */
export const CLUSTER_PALETTE: readonly string[] = [
  "#0072b2", // blue
  "#e69f00", // orange
  "#009e73", // bluish green
  "#cc79a7", // reddish purple
  "#56b4e9", // sky blue
  "#d55e00", // vermillion
  "#ccbb44", // olive yellow
  "#aa3377", // purple
  "#66ccee", // cyan
  "#228833", // green
  "#ee6677", // rose
  "#4477aa", // steel blue
];

/** Lightness step (HSL percentage points) applied on each palette wrap. */
const CYCLE_LIGHTNESS_STEP = 10;
/** Lightness bounds that keep shifted colours visible in both themes. */
const MIN_LIGHTNESS = 38;
const MAX_LIGHTNESS = 72;
/** Hue rotation (degrees) per wrap, so clamped lightness never repeats a colour. */
const CYCLE_HUE_STEP = 5;

export interface ClusterOptions {
  resolution: number;
  seed: number;
  /** Communities smaller than this become "Unclustered" (-1). */
  minClusterSize: number;
}

export interface ClusterInfo {
  id: number;
  color: string;
  /** Member node ids, sorted. */
  members: string[];
}

export interface ClusterResult {
  /** Cluster id for every node (-1 = Unclustered). */
  assignment: Map<string, number>;
  /** Real clusters by id asc, then the Unclustered group if non-empty. */
  clusters: ClusterInfo[];
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Palette colour for cluster `id`; past the palette length, shift lightness
 * (and nudge hue) so later cycles stay distinct.
 */
export function clusterColor(id: number): string {
  if (id < 0) return UNCLUSTERED_COLOR;
  const n = CLUSTER_PALETTE.length;
  const base = CLUSTER_PALETTE[id % n]!;
  const cycle = Math.floor(id / n);
  if (cycle === 0) return base;
  // Alternate lighter / darker with growing distance: +1, -1, +2, -2, ...
  const magnitude = Math.ceil(cycle / 2);
  const sign = cycle % 2 === 1 ? 1 : -1;
  const [h, s, l] = hexToHsl(base);
  const shifted = Math.min(
    MAX_LIGHTNESS,
    Math.max(MIN_LIGHTNESS, l + sign * magnitude * CYCLE_LIGHTNESS_STEP),
  );
  return hslToHex((h + cycle * CYCLE_HUE_STEP) % 360, s, shifted);
}

export function computeClusters(
  nodeIds: readonly string[],
  edges: readonly { source: string; target: string; weight: number }[],
  options: ClusterOptions,
): ClusterResult {
  const ids = [...nodeIds].sort(byId);
  const graph = new UndirectedGraph();
  for (const id of ids) graph.addNode(id);
  for (const e of edges) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) {
      throw new Error(
        `edge ${e.source} -> ${e.target} has an unknown endpoint`,
      );
    }
    if (e.source === e.target || graph.hasEdge(e.source, e.target)) continue;
    graph.addEdge(e.source, e.target, { weight: e.weight });
  }

  // Louvain needs at least one edge; without any, every node is a singleton.
  const raw: Record<string, number> =
    graph.size > 0
      ? louvain(graph, {
          getEdgeWeight: "weight",
          resolution: options.resolution,
          rng: mulberry32(options.seed),
        })
      : Object.fromEntries(ids.map((id, i) => [id, i]));

  const groups = new Map<number, string[]>();
  for (const id of ids) {
    const c = raw[id]!;
    const members = groups.get(c);
    if (members) members.push(id);
    else groups.set(c, [id]);
  }

  // Members are pushed in sorted order, so members[0] is the smallest id.
  const kept = [...groups.values()]
    .filter((m) => m.length >= options.minClusterSize)
    .sort((a, b) => b.length - a.length || byId(a[0]!, b[0]!));

  const assignment = new Map<string, number>(
    ids.map((id) => [id, UNCLUSTERED_ID]),
  );
  const clusters: ClusterInfo[] = kept.map((members, id) => {
    for (const m of members) assignment.set(m, id);
    return { id, color: clusterColor(id), members };
  });
  const unclustered = ids.filter((id) => assignment.get(id) === UNCLUSTERED_ID);
  if (unclustered.length > 0) {
    clusters.push({
      id: UNCLUSTERED_ID,
      color: UNCLUSTERED_COLOR,
      members: unclustered,
    });
  }
  return { assignment, clusters };
}

function hexToHsl(hex: string): [h: number, s: number, l: number] {
  const v = Number.parseInt(hex.slice(1), 16);
  const r = ((v >> 16) & 0xff) / 255;
  const g = ((v >> 8) & 0xff) / 255;
  const b = (v & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
