// Graph assembly for `build-graph` (FR-6, FR-20-23).
//
// Raw repos + README text → nodes, candidate pairs → weighted edges → pruned
// edges → `GraphFile`. Pure: the caller does all I/O.
//
// Signals: topic, owner, mention, dependency (FR-7) and, when embeddings are given, semantic
// (dense cosine over all pairs, T2.2). Pruning streams candidates through a
// per-node top-k heap, so memory stays O(n·k) even for all n² pairs. Clusters
// come from seeded Louvain over the kept edges (FR-24, `lib/clusters.ts`);
// labels are the top TF-IDF terms per cluster (FR-25, `lib/tfidf.ts`). x/y
// come from the seeded ForceAtlas2 layout (FR-27). Manual edges and tags from
// data/manual.yaml (FR-9, FR-29) are forced, with weight max(w, 0.5). Output order is deterministic (nodes by
// id, edges by `(source, target)` with `source < target`); rounding and schema
// key order are applied by `lib/serialize.ts` before writing.

import type { SignalName } from "../../config/graph.config.ts";
import {
  GRAPH_FILE_VERSION,
  type Cluster,
  type Duplicate,
  type GraphFile,
  type RepoEdge,
  type RepoNode,
} from "../../src/lib/graph-schema.ts";
import {
  UNCLUSTERED_COLOR,
  UNCLUSTERED_ID,
  UNCLUSTERED_LABEL,
  computeClusters,
  type ClusterOptions,
} from "./clusters.ts";
import { clusterLabels } from "./tfidf.ts";
import { computeLayout, type LayoutOptions } from "./layout.ts";
import { MANUAL_MIN_WEIGHT, type ManualEdge } from "./manual.ts";
import type { Enrichment } from "../../src/lib/graph-schema.ts";
import { buildMentionIndex, findMentions } from "./mentions.ts";
import { bridgeMetrics, degreeMetrics } from "./metrics.ts";
import { TopKPruner } from "./prune.ts";
import { cleanReadme, excerpt, extractLinks } from "./readme.ts";
import {
  candidatePairs,
  orderSignals,
  pairKey,
  type EdgeSignals,
} from "./signals.ts";
import type { RawRepo } from "./stars.ts";
import {
  combinedWeight,
  isForced,
  renormalizeWeights,
  type SignalWeights,
} from "./weights.ts";

export { UNCLUSTERED_COLOR, UNCLUSTERED_ID, UNCLUSTERED_LABEL };
/** Detail-panel excerpt length in characters (FR-41). */
export const EXCERPT_CHARS = 500;

/** Signals available in M1 (no embeddings, no dependencies). */
export const M1_SIGNALS: readonly SignalName[] = ["topic", "mention", "owner"];
/** Signals available in M2-M3 (embeddings, no dependencies until M4). */
export const M2_SIGNALS: readonly SignalName[] = [
  "semantic",
  "topic",
  "mention",
  "owner",
];
/** Signals available from M4: every signal, dependency included (FR-7). */
export const M4_SIGNALS: readonly SignalName[] = [
  "semantic",
  "topic",
  "mention",
  "dependency",
  "owner",
];

export interface BuildGraphOptions {
  weights: SignalWeights;
  semanticRange: readonly [number, number];
  k: number;
  minWeight: number;
  /** Signals to combine; the weights of the others are renormalised away. */
  enabledSignals: readonly SignalName[];
  /** ForceAtlas2 iterations and seed (FR-27, NFR-4). */
  layout: LayoutOptions;
  /** Louvain settings (FR-24); absent = every node "Unclustered" (M1). */
  clustering?: ClusterOptions;
  /**
   * Cosine at or above which a pair is listed as a possible duplicate (FR-63);
   * absent = no `duplicates` field. Uses raw cosine over every embedded pair,
   * independent of edge pruning.
   */
  duplicateThreshold?: number;
}

export interface BuildGraphInput {
  user: string;
  generatedAt: string;
  repos: readonly RawRepo[];
  /** Raw README markdown by `nameWithOwner`; absent = no README. */
  readmes: ReadonlyMap<string, string>;
  /**
   * Embedding vectors by `nameWithOwner` (FR-5). Used only when `semantic` is
   * enabled; pairs where either side has no vector get no semantic signal.
   */
  embeddings?: ReadonlyMap<string, ArrayLike<number>>;
  /**
   * Directed dependencies between starred repos by `nameWithOwner` (FR-7,
   * `lib/deps.ts`). Used only when `dependency` is enabled.
   */
  dependencies?: ReadonlyMap<string, readonly string[]>;
  /** Labelled edges from data/manual.yaml (FR-29), always kept. */
  manualEdges?: readonly ManualEdge[];
  /** User tags by `nameWithOwner` from data/manual.yaml (FR-9). */
  tags?: ReadonlyMap<string, readonly string[]>;
  /** Validated enrichment by `nameWithOwner` from data/enrichment.json (FR-8). */
  enrichment?: ReadonlyMap<string, Enrichment>;
  options: BuildGraphOptions;
}

export interface BuildGraphStats {
  nodes: number;
  candidates: number;
  /** Pairs with a semantic (cosine) signal. */
  semanticPairs: number;
  /** Pairs at or above `duplicateThreshold`. */
  duplicates: number;
  edges: number;
  forced: number;
  mentionEdges: number;
  dependencyEdges: number;
  manualEdges: number;
  isolated: number;
  /** Real clusters (excluding "Unclustered"). */
  clusters: number;
  unclustered: number;
}

export interface BuildGraphResult {
  graph: GraphFile;
  stats: BuildGraphStats;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Directed mentions: README of each repo → starred repos it links to. */
export function detectMentions(
  repos: readonly RawRepo[],
  readmes: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const index = buildMentionIndex(repos);
  const out = new Map<string, string[]>();
  for (const repo of repos) {
    const md = readmes.get(repo.nameWithOwner);
    if (md === undefined) continue;
    const found = findMentions(index, repo.nameWithOwner, extractLinks(md));
    if (found.length > 0) out.set(repo.nameWithOwner, found);
  }
  return out;
}

export function toRepoNode(
  repo: RawRepo,
  readme: string | undefined,
  metrics: {
    degree: number;
    weightedDegree: number;
    betweenness?: number;
    bridgeScore?: number;
  },
  position: { x: number; y: number } = { x: 0, y: 0 },
  cluster: number = UNCLUSTERED_ID,
  tags: readonly string[] = [],
  enrichment?: Enrichment,
): RepoNode {
  const slash = repo.nameWithOwner.indexOf("/");
  const readmeExcerpt =
    readme === undefined ? "" : excerpt(cleanReadme(readme), EXCERPT_CHARS);
  // Keys in schema order (NFR-4); optional fields are omitted when empty.
  const node: RepoNode = {
    id: repo.nameWithOwner,
    githubId: repo.githubId,
    name: repo.nameWithOwner.slice(slash + 1),
    owner: repo.nameWithOwner.slice(0, slash),
    url: repo.url,
    ...(repo.homepageUrl ? { homepage: repo.homepageUrl } : {}),
    ...(repo.description ? { description: repo.description } : {}),
    ...(readmeExcerpt ? { readmeExcerpt } : {}),
    ...(repo.primaryLanguage ? { language: repo.primaryLanguage } : {}),
    languages: repo.languages.slice(0, 3),
    topics: [...repo.topics],
    ...(tags.length > 0 ? { tags: [...tags] } : {}),
    stars: repo.stargazerCount,
    forks: repo.forkCount,
    ...(repo.license ? { license: repo.license } : {}),
    isArchived: repo.isArchived,
    isFork: repo.isFork,
    // A never-pushed repo has no `pushedAt`; its creation is the last change.
    pushedAt: repo.pushedAt ?? repo.createdAt,
    createdAt: repo.createdAt,
    starredAt: repo.starredAt,
    cluster,
    x: position.x,
    y: position.y,
    metrics: {
      degree: metrics.degree,
      weightedDegree: metrics.weightedDegree,
      ...(metrics.betweenness !== undefined
        ? { betweenness: metrics.betweenness }
        : {}),
      ...(metrics.bridgeScore !== undefined
        ? { bridgeScore: metrics.bridgeScore }
        : {}),
    },
    ...(enrichment ? { enrichment } : {}),
  };
  return node;
}

export function buildGraph(input: BuildGraphInput): BuildGraphResult {
  const { options } = input;
  const repos = [...input.repos].sort((a, b) =>
    byId(a.nameWithOwner, b.nameWithOwner),
  );
  const ids = repos.map((r) => r.nameWithOwner);
  if (new Set(ids).size !== ids.length) {
    throw new Error("duplicate nameWithOwner in input repos");
  }

  const enabled = new Set(options.enabledSignals);
  const coef = renormalizeWeights(options.weights, enabled);
  const mentions = enabled.has("mention")
    ? detectMentions(repos, input.readmes)
    : new Map<string, string[]>();

  const dependencies = enabled.has("dependency")
    ? (input.dependencies ?? new Map<string, string[]>())
    : new Map<string, string[]>();

  const sparse = candidatePairs({
    repos,
    mentions,
    dependencies,
    manual: input.manualEdges,
  });
  const pruner = new TopKPruner<ScoredEdge>({
    k: options.k,
    minWeight: options.minWeight,
  });
  const offer = (source: string, target: string, raw: EdgeSignals) => {
    const signals = { ...raw };
    if (!enabled.has("topic")) {
      delete signals.topic;
      delete signals.sharedTopics;
    }
    if (!enabled.has("owner")) delete signals.owner;
    const combined = combinedWeight(signals, coef, options.semanticRange);
    // FR-29: manual edges never fall below MANUAL_MIN_WEIGHT.
    const weight =
      signals.manual !== undefined
        ? Math.max(combined, MANUAL_MIN_WEIGHT)
        : combined;
    const forced = isForced(signals);
    pruner.offer(source, target, weight, forced, () => ({
      source,
      target,
      weight,
      forced,
      signals: orderSignals(signals),
    }));
  };

  let semanticPairs = 0;
  const duplicates: Duplicate[] = [];
  const dupThreshold = options.duplicateThreshold;
  const vectors = enabled.has("semantic")
    ? normalizedVectors(ids, input.embeddings)
    : [];
  if (vectors.some((v) => v !== undefined)) {
    // Dense pass (FR-20): every pair, merged with its sparse signals. `ids` is
    // sorted, so i < j gives source < target.
    const sparseByKey = new Map(
      sparse.map((p) => [pairKey(p.source, p.target), p.signals]),
    );
    for (let i = 0; i < ids.length; i++) {
      const vi = vectors[i];
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]!;
        const b = ids[j]!;
        const base = sparseByKey.get(pairKey(a, b));
        const vj = vectors[j];
        if (vi === undefined || vj === undefined) {
          if (base) offer(a, b, base);
          continue;
        }
        semanticPairs++;
        const cosine = dot(vi, vj);
        if (dupThreshold !== undefined && cosine >= dupThreshold) {
          duplicates.push([a, b, Math.min(cosine, 1)]);
        }
        // Stored raw (FR-23); rescaled only inside combinedWeight (FR-21).
        offer(a, b, { ...base, semantic: cosine });
      }
    }
  } else {
    for (const pair of sparse) offer(pair.source, pair.target, pair.signals);
  }

  const kept = pruner.result();
  const edges: RepoEdge[] = kept.map((e) => ({
    source: e.source,
    target: e.target,
    weight: e.weight,
    signals: e.signals,
  }));

  const metrics = degreeMetrics(ids, edges);
  const positions = computeLayout(ids, edges, options.layout);
  const clustering = options.clustering
    ? computeClusters(ids, edges, options.clustering)
    : {
        assignment: new Map<string, number>(),
        clusters: [
          { id: UNCLUSTERED_ID, color: UNCLUSTERED_COLOR, members: ids },
        ],
      };
  const clusterOf = (id: string) =>
    clustering.assignment.get(id) ?? UNCLUSTERED_ID;
  const bridges = bridgeMetrics(ids, edges, clusterOf, UNCLUSTERED_ID);
  const nodes = repos.map((repo) =>
    toRepoNode(
      repo,
      input.readmes.get(repo.nameWithOwner),
      {
        ...metrics.get(repo.nameWithOwner)!,
        ...bridges.get(repo.nameWithOwner)!,
      },
      positions.get(repo.nameWithOwner),
      clustering.assignment.get(repo.nameWithOwner) ?? UNCLUSTERED_ID,
      input.tags?.get(repo.nameWithOwner),
      input.enrichment?.get(repo.nameWithOwner),
    ),
  );
  const labels = clusterLabels(
    clustering.clusters,
    new Map(repos.map((r) => [r.nameWithOwner, r])),
  );
  const clusters: Cluster[] = clustering.clusters.map((c) => ({
    id: c.id,
    label: labels.get(c.id) ?? UNCLUSTERED_LABEL,
    color: c.color,
    size: c.members.length,
  }));

  const graph: GraphFile = {
    version: GRAPH_FILE_VERSION,
    generatedAt: input.generatedAt,
    user: input.user,
    clusters,
    nodes,
    edges,
    // Highest cosine first; ties by pair id (serialize re-sorts by id).
    ...(dupThreshold !== undefined
      ? {
          duplicates: duplicates.sort(
            (x, y) => y[2] - x[2] || byId(x[0], y[0]) || byId(x[1], y[1]),
          ),
        }
      : {}),
  };
  return {
    graph,
    stats: {
      nodes: nodes.length,
      candidates: pruner.offered,
      semanticPairs,
      duplicates: duplicates.length,
      edges: edges.length,
      forced: kept.filter((e) => e.forced).length,
      mentionEdges: edges.filter((e) => e.signals.mention).length,
      dependencyEdges: edges.filter((e) => e.signals.dependency).length,
      manualEdges: edges.filter((e) => e.signals.manual !== undefined).length,
      isolated: nodes.filter((n) => n.metrics.degree === 0).length,
      clusters: clusters.filter((c) => c.id !== UNCLUSTERED_ID).length,
      unclustered: nodes.filter((n) => n.cluster === UNCLUSTERED_ID).length,
    },
  };
}

interface ScoredEdge {
  source: string;
  target: string;
  weight: number;
  forced: boolean;
  signals: EdgeSignals;
}

/**
 * Unit-length Float64 copies of the vectors in `ids` order, so cosine is a
 * plain dot product. Missing or zero vectors stay `undefined`; vectors whose
 * length differs from the first one found are rejected.
 */
function normalizedVectors(
  ids: readonly string[],
  embeddings: ReadonlyMap<string, ArrayLike<number>> | undefined,
): (Float64Array | undefined)[] {
  let dims: number | undefined;
  return ids.map((id) => {
    const v = embeddings?.get(id);
    if (v === undefined || v.length === 0) return undefined;
    dims ??= v.length;
    if (v.length !== dims) {
      throw new Error(
        `embedding for ${id} has ${v.length} dims, expected ${dims}`,
      );
    }
    const out = Float64Array.from(v);
    let sumSq = 0;
    for (const x of out) sumSq += x * x;
    const norm = Math.sqrt(sumSq);
    if (norm === 0) return undefined;
    for (let k = 0; k < out.length; k++) out[k]! /= norm;
    return out;
  });
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += a[k]! * b[k]!;
  // Clamp float drift so the schema's [-1, 1] range always holds.
  return Math.min(1, Math.max(-1, s));
}
