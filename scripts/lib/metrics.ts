// Per-node metrics (FR-26). Degree and weighted degree for now; betweenness
// and bridge score arrive in M4 (T4.1).

export interface DegreeMetrics {
  degree: number;
  weightedDegree: number;
}

/** Degree and weighted degree for every node in `nodes` (0 for isolates). */
export function degreeMetrics(
  nodes: readonly string[],
  edges: readonly { source: string; target: string; weight: number }[],
): Map<string, DegreeMetrics> {
  const out = new Map<string, DegreeMetrics>(
    nodes.map((id) => [id, { degree: 0, weightedDegree: 0 }]),
  );
  for (const e of edges) {
    for (const id of [e.source, e.target]) {
      const m = out.get(id);
      if (!m) throw new Error(`edge endpoint ${id} is not a node`);
      m.degree += 1;
      m.weightedDegree += e.weight;
    }
  }
  return out;
}
