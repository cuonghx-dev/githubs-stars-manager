// Embedding input text, cache hash and token windowing (FR-5).
//
// Pure helpers: no model, no file I/O. `scripts/embed.ts` wires them to
// transformers.js and the `data/embeddings.json` cache.

import { createHash } from "node:crypto";
import { cleanReadme } from "./readme.ts";
import type { RawRepo } from "./stars.ts";

export type EmbedTextRepo = Pick<
  RawRepo,
  "nameWithOwner" | "description" | "topics"
>;

/**
 * FR-5 input: `description + topics + cleaned README (first readmeChars)`.
 * Without a usable README the input is `name + description + topics`.
 */
export function buildEmbedText(
  repo: EmbedTextRepo,
  readme: string | null,
  readmeChars: number,
): string {
  const description = repo.description?.trim() ?? "";
  const topics = repo.topics.join(" ");
  const clean = readme ? cleanReadme(readme).slice(0, readmeChars).trim() : "";
  const name = repo.nameWithOwner.split("/")[1] ?? repo.nameWithOwner;
  const parts = clean
    ? [description, topics, clean]
    : [name, description, topics];
  return parts.filter((p) => p.length > 0).join("\n");
}

/** Cache key: sha256 over model id, dtype and the exact input text. */
export function embedHash(
  modelId: string,
  dtype: string,
  text: string,
): string {
  return createHash("sha256")
    .update(`${modelId}\n${dtype}\n${text}`)
    .digest("hex");
}

/**
 * Split token ids into consecutive windows of at most `windowTokens` ids,
 * keeping at most `maxWindows`. Empty input yields no windows.
 */
export function chunkTokenIds<T>(
  ids: readonly T[],
  windowTokens: number,
  maxWindows: number,
): T[][] {
  if (windowTokens <= 0) throw new Error(`bad windowTokens: ${windowTokens}`);
  const windows: T[][] = [];
  for (
    let i = 0;
    i < ids.length && windows.length < maxWindows;
    i += windowTokens
  ) {
    windows.push(ids.slice(i, i + windowTokens));
  }
  return windows;
}

/** L2-normalise in place; a zero vector stays zero. */
export function normalizeInPlace(v: Float32Array): Float32Array {
  let s = 0;
  for (const x of v) s += x * x;
  const norm = Math.sqrt(s);
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) / norm;
  return v;
}

/**
 * Average `rows` row vectors of `dims` values (row-major `data`) and
 * re-normalise the result (FR-5 chunk averaging).
 */
export function averageRows(
  data: ArrayLike<number>,
  rows: number,
  dims: number,
): Float32Array {
  const avg = new Float32Array(dims);
  for (let r = 0; r < rows; r++)
    for (let j = 0; j < dims; j++)
      avg[j] = (avg[j] ?? 0) + (data[r * dims + j] ?? 0);
  return normalizeInPlace(avg);
}
