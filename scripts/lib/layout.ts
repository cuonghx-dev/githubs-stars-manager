// Build-time node positions (FR-27, NFR-4).
//
// Connected nodes: seeded random initial positions → ForceAtlas2 with
// `inferSettings` for `iterations` steps. Isolated nodes (degree 0) do not take
// part in FA2 (they would drift away under repulsion); they sit evenly spaced,
// in id order, on a ring just outside the main layout.
//
// Deterministic: node insertion order is the sorted id list, edges are added in
// the given order, and the only randomness comes from `mulberry32(seed)`.

import { UndirectedGraph } from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { mulberry32 } from "./rng.ts";

export interface LayoutOptions {
  iterations: number;
  seed: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Half-width of the square that seeds initial positions. */
const INITIAL_SPREAD = 100;
/** Ring radius relative to the farthest connected node from the centre. */
const RING_FACTOR = 1.15;
/** Minimum arc length between neighbours on the ring. */
const RING_SPACING = 8;
/** Ring radius when there is no connected layout to surround. */
const MIN_RING_RADIUS = 50;

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function computeLayout(
  nodeIds: readonly string[],
  edges: readonly { source: string; target: string; weight: number }[],
  options: LayoutOptions,
): Map<string, Point> {
  const ids = [...nodeIds].sort(byId);
  const connected = new Set<string>();
  for (const e of edges) {
    connected.add(e.source);
    connected.add(e.target);
  }
  const known = new Set(ids);
  for (const id of connected) {
    if (!known.has(id)) throw new Error(`edge endpoint ${id} is not a node`);
  }

  const positions = new Map<string, Point>();
  const rng = mulberry32(options.seed);

  if (connected.size > 0) {
    const graph = new UndirectedGraph();
    for (const id of ids) {
      if (!connected.has(id)) continue;
      graph.addNode(id, {
        x: (rng() * 2 - 1) * INITIAL_SPREAD,
        y: (rng() * 2 - 1) * INITIAL_SPREAD,
      });
    }
    for (const e of edges) {
      if (e.source === e.target || graph.hasEdge(e.source, e.target)) continue;
      graph.addEdge(e.source, e.target, { weight: e.weight });
    }
    const result = forceAtlas2(graph, {
      iterations: options.iterations,
      settings: forceAtlas2.inferSettings(graph),
      getEdgeWeight: "weight",
    });
    for (const id of ids) {
      const p = result[id];
      if (!p) continue;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        throw new Error(`layout produced a non-finite position for ${id}`);
      }
      positions.set(id, { x: p.x, y: p.y });
    }
  }

  const isolates = ids.filter((id) => !connected.has(id));
  if (isolates.length > 0) {
    let cx = 0;
    let cy = 0;
    for (const p of positions.values()) {
      cx += p.x;
      cy += p.y;
    }
    if (positions.size > 0) {
      cx /= positions.size;
      cy /= positions.size;
    }
    let maxR = 0;
    for (const p of positions.values()) {
      maxR = Math.max(maxR, Math.hypot(p.x - cx, p.y - cy));
    }
    const radius = Math.max(
      maxR * RING_FACTOR,
      (isolates.length * RING_SPACING) / (2 * Math.PI),
      MIN_RING_RADIUS,
    );
    isolates.forEach((id, i) => {
      const angle = (2 * Math.PI * i) / isolates.length;
      positions.set(id, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    });
  }

  return positions;
}
