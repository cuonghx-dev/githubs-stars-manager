/**
 * Single source of tunables for the Stars Graph pipeline and app build
 * (PRD §7.2, implementation plan T0.5). Change values here, never inline.
 */

/** Edge signals combined into one weight (FR-20, FR-21). */
export type SignalName =
  "semantic" | "topic" | "mention" | "dependency" | "owner";

export interface GraphConfig {
  /** Combined-weight coefficients; must sum to 1 (FR-21). */
  readonly weights: Readonly<Record<SignalName, number>>;
  /** Cosine range rescaled to [0, 1] (clamped) before weighting (FR-21). */
  readonly semanticRange: readonly [min: number, max: number];
  /** Keep an edge if it is in the top-k of either endpoint (FR-22). */
  readonly k: number;
  /** Minimum combined weight for a non-forced edge (FR-22). */
  readonly minWeight: number;
  readonly louvain: {
    /** Louvain `resolution` (FR-24). */
    readonly resolution: number;
    /** Seed for the shared PRNG used by Louvain (NFR-4). */
    readonly seed: number;
  };
  /** Clusters smaller than this merge into "Unclustered" (id -1) (FR-24). */
  readonly minClusterSize: number;
  readonly layout: {
    /** ForceAtlas2 iterations (FR-27). */
    readonly iterations: number;
    /** Seed for initial positions (FR-27, NFR-4). */
    readonly seed: number;
  };
  /** Pairs with cosine >= this are "possibly overlapping" (FR-63). */
  readonly duplicateThreshold: number;
  /** A star is "forgotten" if any rule matches (FR-62). */
  readonly forgotten: {
    /** Starred more than this many days ago ... */
    readonly starredOlderThanDays: number;
    /** ... and degree <= this. */
    readonly maxDegree: number;
    /** Archived repos always count. */
    readonly includeArchived: boolean;
    /** Last push older than this many days. */
    readonly pushedOlderThanDays: number;
  };
  /** Keep private repos in the published graph (FR-11). */
  readonly includePrivate: boolean;
  /** Parallel README fetches (FR-3). */
  readonly readmeConcurrency: number;
  readonly embedding: {
    /** transformers.js model id; part of the embedding cache key (FR-5). */
    readonly modelId: string;
    readonly dimensions: number;
    /** Cleaned README chars fed into the embedding text (FR-5). */
    readonly readmeChars: number;
    /** Model input limit in word pieces per chunk (FR-5). */
    readonly maxTokensPerChunk: number;
    readonly maxChunks: number;
  };
  /** Vite `base`; relative keeps the build portable on GitHub Pages (NFR-7). */
  readonly base: string;
}

const config: GraphConfig = {
  weights: {
    semantic: 0.55,
    topic: 0.2,
    mention: 0.15,
    dependency: 0.07,
    owner: 0.03,
  },
  semanticRange: [0.3, 0.9],
  k: 6,
  minWeight: 0.15,
  louvain: {
    resolution: 1,
    seed: 42,
  },
  minClusterSize: 3,
  layout: {
    iterations: 500,
    seed: 42,
  },
  duplicateThreshold: 0.85,
  forgotten: {
    starredOlderThanDays: 365,
    maxDegree: 1,
    includeArchived: true,
    pushedOlderThanDays: 730,
  },
  includePrivate: false,
  readmeConcurrency: 8,
  embedding: {
    modelId: "Xenova/all-MiniLM-L6-v2",
    dimensions: 384,
    readmeChars: 2000,
    maxTokensPerChunk: 256,
    maxChunks: 4,
  },
  base: "./",
};

export default config;
