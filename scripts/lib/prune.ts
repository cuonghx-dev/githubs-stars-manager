// Edge pruning (FR-22).
//
// Every node ranks its candidate edges by weight (desc; ties broken by the
// other endpoint's id, asc, so the result is deterministic). A non-forced edge
// is kept when it is in the top-k of either endpoint AND its weight is at
// least `minWeight`. Forced edges (mention, dependency, manual) are always
// kept. Forced edges take part in the ranking like any other candidate.

export interface WeightedEdge {
  source: string;
  target: string;
  weight: number;
  forced: boolean;
}

export interface PruneOptions {
  k: number;
  minWeight: number;
}

/** Kept edges, in the input order. */
export function pruneEdges<E extends WeightedEdge>(
  edges: readonly E[],
  { k, minWeight }: PruneOptions,
): E[] {
  if (!Number.isInteger(k) || k < 0) {
    throw new Error("k must be a non-negative integer");
  }
  const incident = new Map<string, number[]>();
  const add = (node: string, index: number) => {
    const list = incident.get(node);
    if (list) list.push(index);
    else incident.set(node, [index]);
  };
  edges.forEach((e, i) => {
    add(e.source, i);
    add(e.target, i);
  });

  const inTopK = new Uint8Array(edges.length);
  for (const [node, list] of incident) {
    const other = (i: number) =>
      edges[i]!.source === node ? edges[i]!.target : edges[i]!.source;
    list.sort((a, b) => {
      const dw = edges[b]!.weight - edges[a]!.weight;
      if (dw !== 0) return dw;
      const oa = other(a);
      const ob = other(b);
      return oa < ob ? -1 : oa > ob ? 1 : 0;
    });
    for (const i of list.slice(0, k)) inTopK[i] = 1;
  }

  return edges.filter(
    (e, i) => e.forced || (inTopK[i] === 1 && e.weight >= minWeight),
  );
}
