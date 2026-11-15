// Graph assembly for `build-graph` (FR-6, FR-20-23).
//
// Raw repos + README text → nodes, candidate pairs → weighted edges → pruned
// edges → `GraphFile`. Pure: the caller does all I/O.
//
// M1 scope: topic, owner and mention signals only. Every node is in the
// "Unclustered" group (-1) until clustering lands (M2). x/y come from the
// seeded ForceAtlas2 layout (FR-27). Output order is deterministic (nodes by
// id, edges by `(source, target)` with `source < target`); rounding and schema
// key order are applied by `lib/serialize.ts` before writing.

import type { SignalName } from "../../config/graph.config.ts";
import {
  GRAPH_FILE_VERSION,
  type Cluster,
  type GraphFile,
  type RepoEdge,
  type RepoNode,
} from "../../src/lib/graph-schema.ts";
import { computeLayout, type LayoutOptions } from "./layout.ts";
import { buildMentionIndex, findMentions } from "./mentions.ts";
import { degreeMetrics } from "./metrics.ts";
import { pruneEdges } from "./prune.ts";
import { cleanReadme, excerpt, extractLinks } from "./readme.ts";
import { candidatePairs } from "./signals.ts";
import type { RawRepo } from "./stars.ts";
import {
  combinedWeight,
  isForced,
  renormalizeWeights,
  type SignalWeights,
} from "./weights.ts";

export const UNCLUSTERED_ID = -1;
export const UNCLUSTERED_LABEL = "Unclustered";
/** Neutral grey that reads in both themes. */
export const UNCLUSTERED_COLOR = "#9ca3af";
/** Detail-panel excerpt length in characters (FR-41). */
export const EXCERPT_CHARS = 500;

/** Signals available in M1 (no embeddings, no dependencies). */
export const M1_SIGNALS: readonly SignalName[] = ["topic", "mention", "owner"];

export interface BuildGraphOptions {
  weights: SignalWeights;
  semanticRange: readonly [number, number];
  k: number;
  minWeight: number;
  /** Signals to combine; the weights of the others are renormalised away. */
  enabledSignals: readonly SignalName[];
  /** ForceAtlas2 iterations and seed (FR-27, NFR-4). */
  layout: LayoutOptions;
}

export interface BuildGraphInput {
  user: string;
  generatedAt: string;
  repos: readonly RawRepo[];
  /** Raw README markdown by `nameWithOwner`; absent = no README. */
  readmes: ReadonlyMap<string, string>;
  options: BuildGraphOptions;
}

export interface BuildGraphStats {
  nodes: number;
  candidates: number;
  edges: number;
  forced: number;
  mentionEdges: number;
  isolated: number;
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
  metrics: { degree: number; weightedDegree: number },
  position: { x: number; y: number } = { x: 0, y: 0 },
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
    stars: repo.stargazerCount,
    forks: repo.forkCount,
    ...(repo.license ? { license: repo.license } : {}),
    isArchived: repo.isArchived,
    isFork: repo.isFork,
    // A never-pushed repo has no `pushedAt`; its creation is the last change.
    pushedAt: repo.pushedAt ?? repo.createdAt,
    createdAt: repo.createdAt,
    starredAt: repo.starredAt,
    cluster: UNCLUSTERED_ID,
    x: position.x,
    y: position.y,
    metrics: {
      degree: metrics.degree,
      weightedDegree: metrics.weightedDegree,
    },
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

  const candidates = candidatePairs({ repos, mentions }).map((pair) => {
    const signals = { ...pair.signals };
    if (!enabled.has("topic")) {
      delete signals.topic;
      delete signals.sharedTopics;
    }
    if (!enabled.has("owner")) delete signals.owner;
    return {
      source: pair.source,
      target: pair.target,
      weight: combinedWeight(signals, coef, options.semanticRange),
      forced: isForced(signals),
      signals,
    };
  });

  const kept = pruneEdges(
    candidates.filter((c) => c.forced || c.weight > 0),
    { k: options.k, minWeight: options.minWeight },
  );
  const edges: RepoEdge[] = kept.map((e) => ({
    source: e.source,
    target: e.target,
    weight: e.weight,
    signals: e.signals,
  }));

  const metrics = degreeMetrics(ids, edges);
  const positions = computeLayout(ids, edges, options.layout);
  const nodes = repos.map((repo) =>
    toRepoNode(
      repo,
      input.readmes.get(repo.nameWithOwner),
      metrics.get(repo.nameWithOwner)!,
      positions.get(repo.nameWithOwner),
    ),
  );
  const clusters: Cluster[] = [
    {
      id: UNCLUSTERED_ID,
      label: UNCLUSTERED_LABEL,
      color: UNCLUSTERED_COLOR,
      size: nodes.length,
    },
  ];

  const graph: GraphFile = {
    version: GRAPH_FILE_VERSION,
    generatedAt: input.generatedAt,
    user: input.user,
    clusters,
    nodes,
    edges,
  };
  return {
    graph,
    stats: {
      nodes: nodes.length,
      candidates: candidates.length,
      edges: edges.length,
      forced: kept.filter((e) => e.forced).length,
      mentionEdges: edges.filter((e) => e.signals.mention).length,
      isolated: nodes.filter((n) => n.metrics.degree === 0).length,
    },
  };
}
