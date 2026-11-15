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

/**
 * Streaming form of `pruneEdges` for dense candidate sets (all pairs once
 * embeddings exist, T2.2). Each node keeps a bounded top-k heap, so memory is
 * O(n·k) plus the forced edges instead of O(n²). Ranking and tie-breaking
 * match `pruneEdges`: weight desc, then the other endpoint's id asc.
 *
 * Call `offer` once per candidate pair; `result` returns the kept edges sorted
 * by `(source, target)`. Edge objects are only built for candidates that enter
 * a heap or are forced (`make` is called lazily).
 */
export class TopKPruner<E extends WeightedEdge> {
  readonly #k: number;
  readonly #minWeight: number;
  readonly #heaps = new Map<string, HeapEntry<E>[]>();
  readonly #forced = new Map<string, E>();
  #offered = 0;

  constructor({ k, minWeight }: PruneOptions) {
    if (!Number.isInteger(k) || k < 0) {
      throw new Error("k must be a non-negative integer");
    }
    this.#k = k;
    this.#minWeight = minWeight;
  }

  /** Number of candidates offered (forced or weight > 0). */
  get offered(): number {
    return this.#offered;
  }

  offer(
    source: string,
    target: string,
    weight: number,
    forced: boolean,
    make: () => E,
  ): void {
    if (!forced && !(weight > 0)) return;
    this.#offered++;
    let edge: E | undefined;
    const build = () => (edge ??= make());
    if (forced) this.#forced.set(edgeKey(source, target), build());
    // A forced edge also ranks like any other candidate (as in pruneEdges).
    // Non-forced edges below minWeight can never be kept, but they can still
    // occupy a top-k slot in pruneEdges; keep them in the ranking for parity.
    this.#push(source, target, weight, build);
    this.#push(target, source, weight, build);
  }

  #push(node: string, other: string, weight: number, build: () => E): void {
    if (this.#k === 0) return;
    let heap = this.#heaps.get(node);
    if (!heap) {
      heap = [];
      this.#heaps.set(node, heap);
    }
    if (heap.length < this.#k) {
      heap.push({ weight, other, edge: build() });
      siftUp(heap, heap.length - 1);
      return;
    }
    const worst = heap[0]!;
    if (!ranksAbove(weight, other, worst.weight, worst.other)) return;
    heap[0] = { weight, other, edge: build() };
    siftDown(heap, 0);
  }

  result(): E[] {
    const kept = new Map<string, E>(this.#forced);
    for (const heap of this.#heaps.values()) {
      for (const { edge } of heap) {
        if (edge.weight >= this.#minWeight) {
          kept.set(edgeKey(edge.source, edge.target), edge);
        }
      }
    }
    return [...kept.values()].sort((a, b) =>
      a.source !== b.source
        ? a.source < b.source
          ? -1
          : 1
        : a.target < b.target
          ? -1
          : a.target > b.target
            ? 1
            : 0,
    );
  }
}

interface HeapEntry<E> {
  weight: number;
  other: string;
  edge: E;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

/** True when (wa, oa) ranks strictly before (wb, ob): weight desc, id asc. */
function ranksAbove(wa: number, oa: string, wb: number, ob: string): boolean {
  return wa !== wb ? wa > wb : oa < ob;
}

/** Min-heap on rank: the root is the worst-ranked entry. */
function worse<E>(a: HeapEntry<E>, b: HeapEntry<E>): boolean {
  return ranksAbove(b.weight, b.other, a.weight, a.other);
}

function siftUp<E>(heap: HeapEntry<E>[], i: number): void {
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!worse(heap[i]!, heap[parent]!)) return;
    [heap[i], heap[parent]] = [heap[parent]!, heap[i]!];
    i = parent;
  }
}

function siftDown<E>(heap: HeapEntry<E>[], i: number): void {
  for (;;) {
    const l = 2 * i + 1;
    const r = l + 1;
    let m = i;
    if (l < heap.length && worse(heap[l]!, heap[m]!)) m = l;
    if (r < heap.length && worse(heap[r]!, heap[m]!)) m = r;
    if (m === i) return;
    [heap[i], heap[m]] = [heap[m]!, heap[i]!];
    i = m;
  }
}
