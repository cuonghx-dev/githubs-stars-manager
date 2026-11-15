import type { EdgeDisplayData, NodeDisplayData } from "sigma/types";
import type { RepoGraph } from "@/lib/load-graph";

// Focus mode (FR-34): selecting a node keeps it and its 1-hop neighbours at
// full opacity, dims the 2-hop ring and fades everything else. Pure helpers so
// the reducers can be unit-tested without WebGL.

export interface Focus {
  node: string;
  /** Direct neighbours of `node` (excluding `node`). */
  hop1: ReadonlySet<string>;
  /** Nodes exactly two hops away (excluding `node` and `hop1`). */
  hop2: ReadonlySet<string>;
}

export interface FocusColors {
  /** Colour of faded nodes (outside the 2-hop set). */
  node: string;
  /** Colour of faded edges. */
  edge: string;
  /** Colour of dimmed edges (inside the 2-hop set, not touching `node`). */
  dimEdge: string;
}

/** Share of the fade colour mixed into a dimmed (2-hop) node's colour. */
export const DIM_MIX = 0.55;

export function computeFocus(
  graph: RepoGraph,
  node: string | null,
): Focus | null {
  if (node === null || !graph.hasNode(node)) return null;
  const hop1 = new Set<string>(graph.neighbors(node));
  const hop2 = new Set<string>();
  for (const neighbour of hop1) {
    for (const next of graph.neighbors(neighbour)) {
      if (next !== node && !hop1.has(next)) hop2.add(next);
    }
  }
  return { node, hop1, hop2 };
}

export function nodeFocusStyle(
  key: string,
  color: string,
  focus: Focus | null,
  colors: FocusColors,
): Partial<NodeDisplayData> {
  if (focus === null) return {};
  if (key === focus.node || focus.hop1.has(key)) {
    return { labelVisibility: "visible", depth: "topNodes" };
  }
  if (focus.hop2.has(key)) {
    return { color: mixHex(color, colors.node, DIM_MIX) };
  }
  return { color: colors.node, labelVisibility: "hidden" };
}

export function edgeFocusStyle(
  source: string,
  target: string,
  focus: Focus | null,
  colors: FocusColors,
): Partial<EdgeDisplayData> {
  if (focus === null) return {};
  if (source === focus.node || target === focus.node) {
    return { depth: "topEdges" };
  }
  if (inFocus(source, focus) && inFocus(target, focus)) {
    return { color: colors.dimEdge };
  }
  return { color: colors.edge };
}

function inFocus(key: string, focus: Focus): boolean {
  return key === focus.node || focus.hop1.has(key) || focus.hop2.has(key);
}

const HEX = /^#([0-9a-f]{6})$/i;

/**
 * Linear mix of two `#rrggbb` colours; `t` is the share of `b`. Falls back to
 * `b` when either colour is not a 6-digit hex, so dimming still reads as dim.
 */
export function mixHex(a: string, b: string, t: number): string {
  const ma = HEX.exec(a);
  const mb = HEX.exec(b);
  if (ma?.[1] === undefined || mb?.[1] === undefined) return b;
  const ca = Number.parseInt(ma[1], 16);
  const cb = Number.parseInt(mb[1], 16);
  let out = "#";
  for (const shift of [16, 8, 0]) {
    const x = (ca >> shift) & 0xff;
    const y = (cb >> shift) & 0xff;
    const v = Math.round(x + (y - x) * t);
    out += v.toString(16).padStart(2, "0");
  }
  return out;
}
