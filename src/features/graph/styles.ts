import { layerBorder } from "@sigma/node-border";
import type { PrimitivesDeclaration } from "sigma/primitives";
import {
  layerFill,
  layerPlain,
  pathCurved,
  pathLine,
  pathLoop,
  sdfCircle,
} from "sigma/rendering";
import type { EdgeDisplayData } from "sigma/types";
import type { EdgeKind } from "@/lib/load-graph";

// Edge and node styles (T4.4, FR-35, FR-36). Edge thickness comes from the
// `size` attribute (scaled by weight in load-graph). Mention and dependency
// edges get their own colour; dependency edges are also curved so they stay
// distinct without relying on colour alone. Archived repos render hollow: a
// ring in the node's current colour around a background-coloured centre.

/** Relative ring thickness of a hollow (archived) node, as a share of radius. */
export const HOLLOW_RING = 0.35;

/**
 * Curvature of dependency edges (control-point offset as a share of length).
 * `pathCurved` reads it per edge from the `curvature` variable, not options.
 */
export const DEPENDENCY_CURVATURE = 0.2;

export interface KindColors {
  /** Default edge colour (similarity edges). */
  edgeColor: string;
  mentionEdge: string;
  dependencyEdge: string;
}

export interface HollowColors {
  /** Inner fill of hollow nodes; matches the canvas background. */
  hollow: string;
}

/**
 * Sigma 4 primitives: the default circle + fill, plus a border layer that
 * stays disabled (size 0) unless the reducer sets `hollowRing`; and the
 * default straight/loop edge paths plus a curved one for dependency edges.
 */
export const GRAPH_PRIMITIVES = {
  nodes: {
    shapes: [sdfCircle()],
    variables: {
      hollowRing: { type: "number", default: 0 },
      hollowFill: { type: "color", default: "#ffffff" },
    },
    layers: [
      layerFill(),
      layerBorder({
        borders: [
          {
            size: { attribute: "hollowRing", default: 0 },
            color: { attribute: "color" },
            mode: "relative",
          },
          {
            size: 0,
            color: { attribute: "hollowFill", default: "#ffffff" },
            fill: true,
          },
        ],
      }),
    ],
  },
  edges: {
    paths: [pathLine(), pathLoop(), pathCurved()],
    layers: [layerPlain()],
  },
} satisfies PrimitivesDeclaration;

/** Base colour and path of an edge from its kind (FR-35). */
export function edgeKindStyle(
  kind: EdgeKind,
  colors: KindColors,
): Partial<EdgeDisplayData> & { curvature?: number } {
  switch (kind) {
    case "dependency":
      return {
        color: colors.dependencyEdge,
        path: "curved",
        curvature: DEPENDENCY_CURVATURE,
      };
    case "mention":
      return { color: colors.mentionEdge };
    default:
      return { color: colors.edgeColor };
  }
}

/** Hollow style for archived nodes (FR-36); empty for everything else. */
export function archivedNodeStyle(
  archived: boolean,
  colors: HollowColors,
): Record<string, unknown> {
  if (!archived) return {};
  return { hollowRing: HOLLOW_RING, hollowFill: colors.hollow };
}
