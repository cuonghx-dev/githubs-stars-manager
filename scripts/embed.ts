// `pnpm embed [--full]`: data/raw/stars.json + READMEs → data/embeddings.json
// (FR-5). One 384-dim vector per repo from transformers.js MiniLM. Input text
// and windowing live in scripts/lib/embed-text.ts.
//
// Incremental: a repo is embedded only when sha256(model + dtype + text)
// changed; vectors of repos no longer starred are dropped. The cache is
// flushed atomically every FLUSH_EVERY new vectors, so an interrupted run
// keeps its progress. `--full` ignores the cache.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";
import config from "../config/graph.config.ts";
import {
  averageRows,
  buildEmbedText,
  chunkTokenIds,
  embedHash,
} from "./lib/embed-text.ts";
import { readJsonOr, writeJsonAtomic } from "./lib/fs-atomic.ts";
import { createLogger, type Logger } from "./lib/log.ts";
import { readmePath } from "./lib/readmes.ts";
import {
  STARS_FILE_VERSION,
  filterPrivate,
  type RawRepo,
  type StarsFile,
} from "./lib/stars.ts";
import { READMES_DIR, ROOT, STARS_PATH } from "./sync.ts";

export const EMBEDDINGS_PATH = resolve(ROOT, "data/embeddings.json");
export const MODEL_CACHE_DIR = resolve(ROOT, ".cache/models");
export const FLUSH_EVERY = 100;

/** `data/embeddings.json` entry (PRD §5.1). */
export interface EmbeddingEntry {
  hash: string;
  model: string;
  vector: number[];
}
export type EmbeddingsFile = Record<string, EmbeddingEntry>;

/** Turns one input text into one normalised vector. */
export type Embedder = (text: string) => Promise<Float32Array>;

export interface EmbedDeps {
  logger: Logger;
  starsPath: string;
  readmesDir: string;
  embeddingsPath: string;
  includePrivate: boolean;
  modelId: string;
  dtype: "q8" | "fp32";
  dimensions: number;
  readmeChars: number;
  /** Ignore the embedding cache (`--full`). */
  full: boolean;
  /** Loaded lazily, only when at least one repo needs embedding. */
  loadEmbedder: () => Promise<Embedder>;
}

/** Stable key order and 6-decimal rounding keep the file diff-friendly. */
function serialise(file: EmbeddingsFile): EmbeddingsFile {
  const out: EmbeddingsFile = {};
  for (const key of Object.keys(file).sort()) out[key] = file[key]!;
  return out;
}

function toStored(v: Float32Array): number[] {
  return Array.from(v, (x) => Math.round(x * 1e6) / 1e6);
}

async function readReadme(dir: string, repo: RawRepo): Promise<string | null> {
  if (repo.readme?.status !== "ok") return null;
  try {
    return await readFile(readmePath(dir, repo.nameWithOwner), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function runEmbed(deps: EmbedDeps): Promise<EmbeddingsFile> {
  const step = deps.logger.step("embed");
  const stars = await readJsonOr<StarsFile | null>(deps.starsPath, null);
  if (stars === null) {
    throw new Error(`${deps.starsPath} not found; run \`pnpm sync\` first`);
  }
  if (stars.version !== STARS_FILE_VERSION) {
    throw new Error(
      `${deps.starsPath} has version ${String(stars.version)}, expected ${STARS_FILE_VERSION}; run \`pnpm sync\``,
    );
  }
  const repos = filterPrivate(stars.repos, deps.includePrivate);

  const cached = deps.full
    ? {}
    : await readJsonOr<EmbeddingsFile>(deps.embeddingsPath, {});

  // Keep only current repos; their entries are replaced below when stale.
  const keep = new Set(repos.map((r) => r.githubId));
  const file: EmbeddingsFile = {};
  let removed = 0;
  for (const [id, entry] of Object.entries(cached)) {
    if (keep.has(id)) file[id] = entry;
    else removed++;
  }

  const todo: { repo: RawRepo; text: string; hash: string }[] = [];
  for (const repo of repos) {
    const readme = await readReadme(deps.readmesDir, repo);
    const text = buildEmbedText(repo, readme, deps.readmeChars);
    const hash = embedHash(deps.modelId, deps.dtype, text);
    const prev = file[repo.githubId];
    if (prev && prev.hash === hash && prev.vector.length === deps.dimensions) {
      continue;
    }
    todo.push({ repo, text, hash });
  }

  step.set("repos", repos.length);
  step.set("embedded", 0);
  step.set("cached", repos.length - todo.length);
  step.set("removed", removed);

  if (todo.length > 0) {
    step.info(
      `embedding ${todo.length} repos with ${deps.modelId} (${deps.dtype})`,
    );
    const embed = await deps.loadEmbedder();
    let sinceFlush = 0;
    for (const [i, { repo, text, hash }] of todo.entries()) {
      const vector = await embed(text);
      if (vector.length !== deps.dimensions) {
        throw new Error(
          `${repo.nameWithOwner}: expected ${deps.dimensions} dims, got ${vector.length}`,
        );
      }
      file[repo.githubId] = {
        hash,
        model: deps.modelId,
        vector: toStored(vector),
      };
      step.count("embedded");
      if (++sinceFlush >= FLUSH_EVERY) {
        await writeJsonAtomic(deps.embeddingsPath, serialise(file));
        step.info(`embedded ${i + 1}/${todo.length}`);
        sinceFlush = 0;
      }
    }
  }

  const out = serialise(file);
  await writeJsonAtomic(deps.embeddingsPath, out);
  step.done();
  return out;
}

/**
 * transformers.js MiniLM embedder (FR-5): windows of <= maxTokensPerChunk - 2
 * content tokens (CLS/SEP are added by the pipeline), at most maxChunks
 * windows, mean pooling + normalise per window, then average and re-normalise.
 */
export async function loadMiniLmEmbedder(opts: {
  modelId: string;
  dtype: "q8" | "fp32";
  cacheDir: string;
  maxTokensPerChunk: number;
  maxChunks: number;
}): Promise<Embedder> {
  env.cacheDir = opts.cacheDir;
  env.allowRemoteModels = true;
  let extractor: FeatureExtractionPipeline;
  try {
    extractor = await pipeline("feature-extraction", opts.modelId, {
      dtype: opts.dtype,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `could not load embedding model ${opts.modelId} (${opts.dtype}) into ${opts.cacheDir}: ${reason}. ` +
        "The first run downloads it from Hugging Face; check your network connection and retry.",
      { cause: error },
    );
  }
  const tokenizer = extractor.tokenizer;
  const windowTokens = opts.maxTokensPerChunk - 2;

  return async (text) => {
    const ids = tokenizer.encode(text, { add_special_tokens: false });
    const chunks = chunkTokenIds(ids, windowTokens, opts.maxChunks).map((w) =>
      tokenizer.decode(w, { skip_special_tokens: true }),
    );
    if (chunks.length === 0) chunks.push(text || " ");
    const out = await extractor(chunks, { pooling: "mean", normalize: true });
    const [rows, dims] = out.dims as [number, number];
    return averageRows(out.data as Float32Array, rows, dims);
  };
}

async function main(): Promise<void> {
  const e = config.embedding;
  await runEmbed({
    logger: createLogger(),
    starsPath: STARS_PATH,
    readmesDir: READMES_DIR,
    embeddingsPath: EMBEDDINGS_PATH,
    includePrivate: config.includePrivate,
    modelId: e.modelId,
    dtype: e.dtype,
    dimensions: e.dimensions,
    readmeChars: e.readmeChars,
    full: process.argv.includes("--full"),
    loadEmbedder: () =>
      loadMiniLmEmbedder({
        modelId: e.modelId,
        dtype: e.dtype,
        cacheDir: MODEL_CACHE_DIR,
        maxTokensPerChunk: e.maxTokensPerChunk,
        maxChunks: e.maxChunks,
      }),
  });
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
