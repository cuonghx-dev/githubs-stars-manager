// Edge signals per repo pair (FR-20) and their stored breakdown (FR-23).
//
// - semantic: cosine of embeddings (raw cosine is stored; M2).
// - topic: Jaccard of topic sets, 0 when either set is empty.
// - mention: either README links to the other (FR-28), undirected.
// - dependency: either depends on the other (M4).
// - owner: same owner (case-insensitive).
//
// Candidate pairs are only produced where at least one signal is non-zero, so
// a graph without embeddings never builds the full O(n²) pair list. All
// functions are pure and deterministic.

/** Signal breakdown stored on each edge; mirrors `RepoEdge.signals`. */
export interface EdgeSignals {
  semantic?: number;
  topic?: number;
  sharedTopics?: string[];
  mention?: boolean;
  dependency?: boolean;
  owner?: boolean;
}

/** An undirected repo pair with `source < target` (code-unit order). */
export interface CandidatePair {
  source: string;
  target: string;
  signals: EdgeSignals;
}

/** The repo fields the M1 signals need (a subset of `RawRepo`). */
export interface SignalRepo {
  nameWithOwner: string;
  topics: readonly string[];
}

/** Cosine similarity; 0 when either vector has zero length. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: length mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * Jaccard index of two sets plus the shared members (sorted). 0 when either
 * set is empty (FR-20).
 */
export function jaccard(
  a: Iterable<string>,
  b: Iterable<string>,
): { value: number; shared: string[] } {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return { value: 0, shared: [] };
  const shared = [...setA].filter((x) => setB.has(x)).sort();
  const union = setA.size + setB.size - shared.length;
  return { value: shared.length / union, shared };
}

/** Lowercase owner part of `owner/repo`. */
export function ownerOf(nameWithOwner: string): string {
  return nameWithOwner.slice(0, nameWithOwner.indexOf("/")).toLowerCase();
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function normalizeTopics(topics: readonly string[]): string[] {
  return [...new Set(topics.map((t) => t.trim().toLowerCase()))]
    .filter((t) => t !== "")
    .sort();
}

export interface CandidateInput {
  repos: readonly SignalRepo[];
  /**
   * Directed mentions: README of `key` links to each repo in the value (from
   * `findMentions`). Unknown repo names and self-links are ignored.
   */
  mentions?: ReadonlyMap<string, readonly string[]>;
}

/**
 * All pairs with a non-zero topic, mention or owner signal, sorted by
 * `(source, target)`. Each pair carries only the signals that are present.
 */
export function candidatePairs(input: CandidateInput): CandidatePair[] {
  const names = new Set(input.repos.map((r) => r.nameWithOwner));
  const pairs = new Map<string, CandidatePair>();
  const get = (a: string, b: string): CandidatePair => {
    const key = pairKey(a, b);
    let pair = pairs.get(key);
    if (!pair) {
      const [source, target] = orderPair(a, b);
      pair = { source, target, signals: {} };
      pairs.set(key, pair);
    }
    return pair;
  };

  // Topic: only pairs sharing at least one topic can have Jaccard > 0.
  const topics = new Map<string, string[]>();
  const byTopic = new Map<string, string[]>();
  for (const repo of input.repos) {
    const own = normalizeTopics(repo.topics);
    topics.set(repo.nameWithOwner, own);
    for (const topic of own) {
      const members = byTopic.get(topic);
      if (members) members.push(repo.nameWithOwner);
      else byTopic.set(topic, [repo.nameWithOwner]);
    }
  }
  const seen = new Set<string>();
  for (const members of byTopic.values()) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i]!;
        const b = members[j]!;
        const key = pairKey(a, b);
        if (seen.has(key)) continue;
        seen.add(key);
        const { value, shared } = jaccard(topics.get(a)!, topics.get(b)!);
        const pair = get(a, b);
        pair.signals.topic = value;
        pair.signals.sharedTopics = shared;
      }
    }
  }

  // Owner.
  const byOwner = new Map<string, string[]>();
  for (const repo of input.repos) {
    const owner = ownerOf(repo.nameWithOwner);
    const members = byOwner.get(owner);
    if (members) members.push(repo.nameWithOwner);
    else byOwner.set(owner, [repo.nameWithOwner]);
  }
  for (const members of byOwner.values()) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        get(members[i]!, members[j]!).signals.owner = true;
      }
    }
  }

  // Mention: undirected, either side.
  for (const [from, targets] of input.mentions ?? []) {
    if (!names.has(from)) continue;
    for (const to of targets) {
      if (to === from || !names.has(to)) continue;
      get(from, to).signals.mention = true;
    }
  }

  return [...pairs.values()]
    .map((pair) => ({ ...pair, signals: orderSignals(pair.signals) }))
    .sort((a, b) =>
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

/** Same signals with keys in schema order (NFR-4). */
export function orderSignals(s: EdgeSignals): EdgeSignals {
  const out: EdgeSignals = {};
  if (s.semantic !== undefined) out.semantic = s.semantic;
  if (s.topic !== undefined) out.topic = s.topic;
  if (s.sharedTopics !== undefined) out.sharedTopics = s.sharedTopics;
  if (s.mention !== undefined) out.mention = s.mention;
  if (s.dependency !== undefined) out.dependency = s.dependency;
  if (s.owner !== undefined) out.owner = s.owner;
  return out;
}
