import { z } from "zod";

// Contract between the pipeline (`build-graph` writes `public/graph.json`) and
// the app (loads and validates it). Mirrors PRD §5.1. Bump GRAPH_FILE_VERSION
// on breaking changes; the app rejects unknown versions (FR-37).
//
// Field order matches the PRD so `build-graph` can write keys in schema order
// (NFR-4). Unknown keys are stripped on parse.

export const GRAPH_FILE_VERSION = 1;

const isoDate = z.iso.datetime({ offset: true });
const repoId = z.string().regex(/^[^/\s]+\/[^/\s]+$/, "expected owner/repo");
const unit = z.number().min(0).max(1);
const count = z.number().int().nonnegative();

export const enrichmentCategorySchema = z.enum([
  "library",
  "framework",
  "tool",
  "app",
  "awesome-list",
  "learning",
  "dataset",
  "other",
]);

// PRD §5.3. Shared shape; the enrichment *file* schema (with reporting of
// invalid entries) lives in scripts/lib/enrichment.ts.
export const enrichmentSchema = z.object({
  summary: z.string(),
  category: enrichmentCategorySchema,
  concepts: z.array(z.string()),
  alternativesTo: z.array(repoId).optional(),
  enrichedAt: isoDate,
});

export const clusterSchema = z.object({
  id: z.number().int().min(-1), // -1 = "Unclustered"
  label: z.string(),
  color: z.string(),
  size: count,
});

export const repoNodeSchema = z.object({
  id: repoId,
  githubId: z.string().min(1),
  name: z.string().min(1),
  owner: z.string().min(1),
  url: z.url(),
  homepage: z.string().optional(),
  description: z.string().optional(),
  readmeExcerpt: z.string().optional(),
  language: z.string().optional(),
  languages: z.array(z.string()).max(3),
  topics: z.array(z.string()),
  tags: z.array(z.string()).optional(),
  stars: count,
  forks: count,
  license: z.string().optional(),
  isArchived: z.boolean(),
  isFork: z.boolean(),
  pushedAt: isoDate,
  createdAt: isoDate,
  starredAt: isoDate,
  cluster: z.number().int().min(-1),
  x: z.number(),
  y: z.number(),
  metrics: z.object({
    degree: count,
    weightedDegree: z.number().nonnegative(),
    betweenness: z.number().nonnegative().optional(),
    bridgeScore: z.number().nonnegative().optional(),
  }),
  enrichment: enrichmentSchema.optional(),
});

export const edgeSignalsSchema = z.object({
  semantic: z.number().min(-1).max(1).optional(), // raw cosine
  topic: unit.optional(), // Jaccard
  sharedTopics: z.array(z.string()).optional(),
  mention: z.boolean().optional(),
  dependency: z.boolean().optional(),
  owner: z.boolean().optional(),
  manual: z.string().optional(), // edge label, e.g. "alternative-of"
});

export const repoEdgeSchema = z.object({
  source: repoId,
  target: repoId,
  weight: unit,
  signals: edgeSignalsSchema,
});

export const conceptNodeSchema = z.object({
  id: z.string().startsWith("concept:"),
  label: z.string(),
  repos: z.array(repoId),
});

export const duplicateSchema = z.tuple([
  repoId,
  repoId,
  z.number().min(-1).max(1),
]);

export const graphFileSchema = z.object({
  version: z.literal(GRAPH_FILE_VERSION),
  generatedAt: isoDate,
  user: z.string().min(1),
  clusters: z.array(clusterSchema),
  nodes: z.array(repoNodeSchema),
  edges: z.array(repoEdgeSchema),
  duplicates: z.array(duplicateSchema).optional(),
  concepts: z.array(conceptNodeSchema).optional(),
});

export type EnrichmentCategory = z.infer<typeof enrichmentCategorySchema>;
export type Enrichment = z.infer<typeof enrichmentSchema>;
export type Cluster = z.infer<typeof clusterSchema>;
export type RepoNode = z.infer<typeof repoNodeSchema>;
export type EdgeSignals = z.infer<typeof edgeSignalsSchema>;
export type RepoEdge = z.infer<typeof repoEdgeSchema>;
export type ConceptNode = z.infer<typeof conceptNodeSchema>;
export type Duplicate = z.infer<typeof duplicateSchema>;
export type GraphFile = z.infer<typeof graphFileSchema>;

export type ParseGraphResult =
  | { ok: true; data: GraphFile }
  | { ok: false; reason: "unsupported-version" | "invalid"; message: string };

// Validate untrusted JSON (FR-37). Distinguishes an unknown `version` from
// other shape errors so the app can show the right message.
export function parseGraphFile(input: unknown): ParseGraphResult {
  if (
    typeof input === "object" &&
    input !== null &&
    "version" in input &&
    input.version !== GRAPH_FILE_VERSION
  ) {
    return {
      ok: false,
      reason: "unsupported-version",
      message: `unsupported graph.json version ${JSON.stringify(input.version)}; expected ${GRAPH_FILE_VERSION}`,
    };
  }
  const result = graphFileSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    reason: "invalid",
    message: z.prettifyError(result.error),
  };
}
