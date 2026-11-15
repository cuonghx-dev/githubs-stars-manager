// `pnpm build-graph`: data/raw/stars.json + READMEs → public/graph.json
// (FR-6, FR-20-24, FR-27). I/O and wiring only; logic lives in
// scripts/lib/graph.ts, stable output in scripts/lib/serialize.ts.
//
// Signals: semantic (from data/embeddings.json, `pnpm embed`), topic, owner,
// mention and dependency (from data/raw/deps.json, `pnpm sync`, FR-7), weights
// renormalised per FR-21. Optional data/manual.yaml adds user tags, labelled
// forced edges and a hide list (FR-9, FR-29); invalid entries are reported as
// warnings, never fatal. Without a deps file the dependency signal is off. Without an embeddings file the
// build falls back to the M1 signals with a warning. Seeded Louvain clusters
// (FR-24) and seeded ForceAtlas2 layout. The output is schema-validated
// and byte-identical across runs apart from `generatedAt` (NFR-4).

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import config from "../config/graph.config.ts";
import { readJsonOr, writeTextAtomic } from "./lib/fs-atomic.ts";
import {
  DEPS_FILE_VERSION,
  resolveDependencies,
  type DepsFile,
} from "./lib/deps.ts";
import { M4_SIGNALS, buildGraph, type BuildGraphOptions } from "./lib/graph.ts";
import { createLogger, type Logger } from "./lib/log.ts";
import { emptyManualData, parseManual, type ManualData } from "./lib/manual.ts";
import { readmePath } from "./lib/readmes.ts";
import { normalizeGraph } from "./lib/serialize.ts";
import {
  STARS_FILE_VERSION,
  filterPrivate,
  type StarsFile,
} from "./lib/stars.ts";
import { DEPS_PATH, READMES_DIR, ROOT, STARS_PATH } from "./sync.ts";
import type { GraphFile } from "../src/lib/graph-schema.ts";
import type { EmbeddingsFile } from "./embed.ts";

export const GRAPH_PATH = resolve(ROOT, "public/graph.json");
/** Same path as `EMBEDDINGS_PATH` in embed.ts (not imported: it loads the model runtime). */
export const EMBEDDINGS_PATH = resolve(ROOT, "data/embeddings.json");
/** Hand-edited tags, labelled edges and hide list (FR-9, PRD §5.4). */
export const MANUAL_PATH = resolve(ROOT, "data/manual.yaml");
/** NFR-2 payload budget. */
export const GRAPH_SIZE_BUDGET = 3 * 1024 * 1024;

export interface BuildGraphDeps {
  logger: Logger;
  starsPath: string;
  readmesDir: string;
  graphPath: string;
  /** `data/embeddings.json`; absent/`null` disables the semantic signal. */
  embeddingsPath?: string | null;
  /** `data/raw/deps.json`; absent/`null` disables the dependency signal. */
  depsPath?: string | null;
  /** `data/manual.yaml`; absent/`null` or missing file = no manual data. */
  manualPath?: string | null;
  /** Only vectors from this model are used (FR-5); defaults to the config model. */
  modelId?: string;
  includePrivate: boolean;
  options: BuildGraphOptions;
  now: () => Date;
}

export async function runBuildGraph(deps: BuildGraphDeps): Promise<GraphFile> {
  const step = deps.logger.step("build-graph");
  const stars = await readJsonOr<StarsFile | null>(deps.starsPath, null);
  if (stars === null) {
    throw new Error(`${deps.starsPath} not found; run \`pnpm sync\` first`);
  }
  if (stars.version !== STARS_FILE_VERSION) {
    throw new Error(
      `${deps.starsPath} has version ${String(stars.version)}, expected ${STARS_FILE_VERSION}; run \`pnpm sync\``,
    );
  }
  // sync already filters; re-check so a stale file never leaks private repos.
  const visible = filterPrivate(stars.repos, deps.includePrivate);

  // Manual data (FR-9, FR-29): problems are warnings, never fatal.
  const manual = await readManual(
    deps.manualPath,
    visible.map((r) => r.nameWithOwner),
  );
  for (const problem of manual.problems) step.warn(`manual.yaml ${problem}`);
  const repos = visible.filter((r) => !manual.hide.has(r.nameWithOwner));

  const readmes = new Map<string, string>();
  await Promise.all(
    repos
      .filter((r) => r.readme?.status === "ok")
      .map(async (r) => {
        try {
          const md = await readFile(
            readmePath(deps.readmesDir, r.nameWithOwner),
            "utf8",
          );
          readmes.set(r.nameWithOwner, md);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          step.count("readmeMissingFile");
        }
      }),
  );

  // Embeddings are keyed by githubId (stable across renames, FR-4).
  const embeddings = new Map<string, number[]>();
  const modelId = deps.modelId ?? config.embedding.modelId;
  let options = deps.options;
  if (options.enabledSignals.includes("semantic")) {
    const file =
      deps.embeddingsPath == null
        ? null
        : await readJsonOr<EmbeddingsFile | null>(deps.embeddingsPath, null);
    if (file === null) {
      step.warn(
        "no embeddings found; run `pnpm embed` (semantic signal disabled)",
      );
      options = {
        ...options,
        enabledSignals: options.enabledSignals.filter((s) => s !== "semantic"),
      };
    } else {
      for (const repo of repos) {
        const entry = file[repo.githubId];
        if (entry?.model === modelId && entry.vector.length > 0) {
          embeddings.set(repo.nameWithOwner, entry.vector);
        } else {
          step.count("missingVectors");
        }
      }
      if (embeddings.size < repos.length) {
        step.warn(
          `${repos.length - embeddings.size} repos have no ${modelId} vector; run \`pnpm embed\``,
        );
      }
    }
  }

  let dependencies = new Map<string, string[]>();
  if (options.enabledSignals.includes("dependency")) {
    const file =
      deps.depsPath == null
        ? null
        : await readJsonOr<DepsFile | null>(deps.depsPath, null);
    if (file === null || file.version !== DEPS_FILE_VERSION) {
      step.warn(
        "no dependency cache found; run `pnpm sync` (dependency signal disabled)",
      );
      options = {
        ...options,
        enabledSignals: options.enabledSignals.filter(
          (s) => s !== "dependency",
        ),
      };
    } else {
      dependencies = resolveDependencies(repos, file);
    }
  }

  const { graph, stats } = buildGraph({
    user: stars.user,
    generatedAt: deps.now().toISOString(),
    repos,
    readmes,
    embeddings,
    dependencies,
    manualEdges: manual.edges,
    tags: manual.tags,
    options,
  });

  // Budget check (plan §4): pruning keeps at most k non-forced edges per node.
  const nonForced = stats.edges - stats.forced;
  if (nonForced > options.k * stats.nodes) {
    throw new Error(
      `non-forced edges ${nonForced} exceed k × nodes = ${options.k * stats.nodes}`,
    );
  }

  // Sort, round and validate before writing (NFR-4, plan §3.2).
  const output = normalizeGraph(graph);
  const text = `${JSON.stringify(output, null, 2)}\n`;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > GRAPH_SIZE_BUDGET) {
    step.warn(
      `graph.json is ${(bytes / 1024 / 1024).toFixed(2)} MB (budget 3 MB, NFR-2)`,
    );
  }
  await writeTextAtomic(deps.graphPath, text);

  step.set("nodes", stats.nodes);
  step.set("candidates", stats.candidates);
  step.set("semanticPairs", stats.semanticPairs);
  step.set("duplicates", stats.duplicates);
  step.set("edges", stats.edges);
  step.set("forced", stats.forced);
  step.set("mentions", stats.mentionEdges);
  step.set("dependencies", stats.dependencyEdges);
  step.set("manual", stats.manualEdges);
  step.set("tagged", manual.tags.size);
  step.set("hidden", visible.length - repos.length);
  step.set("manualProblems", manual.problems.length);
  step.set("isolated", stats.isolated);
  step.set("clusters", stats.clusters);
  step.set("unclustered", stats.unclustered);
  step.set("kb", Math.round(bytes / 1024));
  step.done();
  return output;
}

async function readManual(
  path: string | null | undefined,
  knownIds: readonly string[],
): Promise<ManualData> {
  if (path == null) return emptyManualData();
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyManualData();
    }
    throw error;
  }
  return parseManual(text, knownIds);
}

async function main(): Promise<void> {
  await runBuildGraph({
    logger: createLogger(),
    starsPath: STARS_PATH,
    readmesDir: READMES_DIR,
    graphPath: GRAPH_PATH,
    embeddingsPath: EMBEDDINGS_PATH,
    depsPath: DEPS_PATH,
    manualPath: MANUAL_PATH,
    modelId: config.embedding.modelId,
    includePrivate: config.includePrivate,
    options: {
      weights: config.weights,
      semanticRange: config.semanticRange,
      k: config.k,
      minWeight: config.minWeight,
      enabledSignals: M4_SIGNALS,
      layout: config.layout,
      duplicateThreshold: config.duplicateThreshold,
      clustering: {
        resolution: config.louvain.resolution,
        seed: config.louvain.seed,
        minClusterSize: config.minClusterSize,
      },
    },
    now: () => new Date(),
  });
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
