// `pnpm build-graph`: data/raw/stars.json + READMEs → public/graph.json
// (FR-6, FR-20-23). I/O and wiring only; logic lives in scripts/lib/graph.ts.
//
// M1: topic, owner and mention signals (weights renormalised per FR-21); all
// nodes unclustered; layout and stable serialisation come with T1.7.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import config from "../config/graph.config.ts";
import { readJsonOr, writeTextAtomic } from "./lib/fs-atomic.ts";
import { M1_SIGNALS, buildGraph, type BuildGraphOptions } from "./lib/graph.ts";
import { createLogger, type Logger } from "./lib/log.ts";
import { readmePath } from "./lib/readmes.ts";
import {
  STARS_FILE_VERSION,
  filterPrivate,
  type StarsFile,
} from "./lib/stars.ts";
import { READMES_DIR, ROOT, STARS_PATH } from "./sync.ts";
import type { GraphFile } from "../src/lib/graph-schema.ts";

export const GRAPH_PATH = resolve(ROOT, "public/graph.json");
/** NFR-2 payload budget. */
export const GRAPH_SIZE_BUDGET = 3 * 1024 * 1024;

export interface BuildGraphDeps {
  logger: Logger;
  starsPath: string;
  readmesDir: string;
  graphPath: string;
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
  const repos = filterPrivate(stars.repos, deps.includePrivate);

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

  const { graph, stats } = buildGraph({
    user: stars.user,
    generatedAt: deps.now().toISOString(),
    repos,
    readmes,
    options: deps.options,
  });

  // Budget check (plan §4): pruning keeps at most k non-forced edges per node.
  const nonForced = stats.edges - stats.forced;
  if (nonForced > deps.options.k * stats.nodes) {
    throw new Error(
      `non-forced edges ${nonForced} exceed k × nodes = ${deps.options.k * stats.nodes}`,
    );
  }

  const text = `${JSON.stringify(graph, null, 2)}\n`;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > GRAPH_SIZE_BUDGET) {
    step.warn(
      `graph.json is ${(bytes / 1024 / 1024).toFixed(2)} MB (budget 3 MB, NFR-2)`,
    );
  }
  await writeTextAtomic(deps.graphPath, text);

  step.set("nodes", stats.nodes);
  step.set("candidates", stats.candidates);
  step.set("edges", stats.edges);
  step.set("forced", stats.forced);
  step.set("mentions", stats.mentionEdges);
  step.set("isolated", stats.isolated);
  step.set("kb", Math.round(bytes / 1024));
  step.done();
  return graph;
}

async function main(): Promise<void> {
  await runBuildGraph({
    logger: createLogger(),
    starsPath: STARS_PATH,
    readmesDir: READMES_DIR,
    graphPath: GRAPH_PATH,
    includePrivate: config.includePrivate,
    options: {
      weights: config.weights,
      semanticRange: config.semanticRange,
      k: config.k,
      minWeight: config.minWeight,
      enabledSignals: M1_SIGNALS,
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
