// Stable serialisation of `graph.json` (NFR-4, plan §4).
//
// - nodes sorted by id; edges stored with `source < target` and sorted by
//   `(source, target)`; clusters by id; duplicates and concepts sorted too;
// - weights, cosines and other fractional metrics rounded to 4 decimals,
//   coordinates to 2;
// - object keys in schema order and unknown keys dropped: the zod schema
//   rebuilds every object from its shape, which also validates the output
//   before it is written.

import {
  parseGraphFile,
  type Duplicate,
  type GraphFile,
  type RepoEdge,
  type RepoNode,
} from "../../src/lib/graph-schema.ts";

export const WEIGHT_DIGITS = 4;
export const COORD_DIGITS = 2;

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Round half away from zero; never returns `-0`. */
export function round(value: number, digits: number): number {
  const f = 10 ** digits;
  const r = (Math.sign(value) * Math.round(Math.abs(value) * f)) / f;
  return r === 0 ? 0 : r;
}

const w = (v: number) => round(v, WEIGHT_DIGITS);
const optW = (v: number | undefined) => (v === undefined ? undefined : w(v));

function normalizeNode(node: RepoNode): RepoNode {
  return {
    ...node,
    x: round(node.x, COORD_DIGITS),
    y: round(node.y, COORD_DIGITS),
    metrics: {
      ...node.metrics,
      weightedDegree: w(node.metrics.weightedDegree),
      betweenness: optW(node.metrics.betweenness),
      bridgeScore: optW(node.metrics.bridgeScore),
    },
  };
}

function normalizeEdge(edge: RepoEdge): RepoEdge {
  const [source, target] =
    edge.source <= edge.target
      ? [edge.source, edge.target]
      : [edge.target, edge.source];
  const signals = {
    ...edge.signals,
    semantic: optW(edge.signals.semantic),
    topic: optW(edge.signals.topic),
    sharedTopics: edge.signals.sharedTopics
      ? [...edge.signals.sharedTopics].sort(byId)
      : undefined,
  };
  return { ...edge, source, target, weight: w(edge.weight), signals };
}

function normalizeDuplicate([a, b, cos]: Duplicate): Duplicate {
  return a <= b ? [a, b, w(cos)] : [b, a, w(cos)];
}

/** Drop keys whose value is `undefined` so optional fields are omitted. */
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)]),
    );
  }
  return value;
}

/**
 * Sort, round and validate. Throws with a readable message when the result
 * does not match the `GraphFile` schema.
 */
export function normalizeGraph(graph: GraphFile): GraphFile {
  const draft = {
    ...graph,
    clusters: [...graph.clusters].sort((a, b) => a.id - b.id),
    nodes: graph.nodes.map(normalizeNode).sort((a, b) => byId(a.id, b.id)),
    edges: graph.edges
      .map(normalizeEdge)
      .sort((a, b) => byId(a.source, b.source) || byId(a.target, b.target)),
    duplicates: graph.duplicates
      ?.map(normalizeDuplicate)
      .sort((a, b) => byId(a[0], b[0]) || byId(a[1], b[1])),
    concepts: graph.concepts
      ?.map((c) => ({ ...c, repos: [...c.repos].sort(byId) }))
      .sort((a, b) => byId(a.id, b.id)),
  };
  const result = parseGraphFile(stripUndefined(draft));
  if (!result.ok) {
    throw new Error(`graph.json failed schema validation: ${result.message}`);
  }
  // Parse output follows the schema shape, so keys come out in schema order.
  return result.data;
}

/** Byte-stable JSON text for `graph.json` (2-space indent, trailing newline). */
export function serializeGraph(graph: GraphFile): string {
  return `${JSON.stringify(normalizeGraph(graph), null, 2)}\n`;
}
