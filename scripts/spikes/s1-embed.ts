// Spike S1 (implementation-plan §7): does @huggingface/transformers run
// Xenova/all-MiniLM-L6-v2 under Node on macOS arm64, where is the model
// cached, and how fast is it?
//
// Embeds the first N cached READMEs (data/raw/readmes, sorted by file name)
// with the same windowing T2.1 will use: cleaned text, windows of <= 254
// content tokens (+ CLS/SEP), at most 4 windows, mean pooling + normalise per
// window, then average and re-normalise. Prints timings and an extrapolation
// to 1,000 repos against the 5 min budget.
//
// Usage: pnpm tsx scripts/spikes/s1-embed.ts [--n 100]

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { env, pipeline } from "@huggingface/transformers";
import { cleanReadme } from "../lib/readme.ts";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const WINDOW_TOKENS = 254;
const MAX_WINDOWS = 4;
const BUDGET_MS = 5 * 60 * 1000;
const CACHE_DIR = path.resolve(".cache/models");
const README_DIR = path.resolve("data/raw/readmes");

function argN(): number {
  const i = process.argv.indexOf("--n");
  const n = i >= 0 ? Number(process.argv[i + 1]) : 100;
  if (!Number.isInteger(n) || n <= 0) throw new Error(`bad --n: ${n}`);
  return n;
}

function normaliseInPlace(v: Float32Array): void {
  let s = 0;
  for (const x of v) s += x * x;
  const norm = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) / norm;
}

async function main(): Promise<void> {
  const n = argN();
  env.cacheDir = CACHE_DIR;
  env.allowRemoteModels = true;

  console.log(`node ${process.version} ${process.platform}/${process.arch}`);
  console.log(`cacheDir ${env.cacheDir}`);

  const tLoad0 = performance.now();
  const dtype = (process.env.S1_DTYPE ?? "fp32") as "fp32" | "q8";
  console.log(`dtype ${dtype}`);
  const extractor = await pipeline("feature-extraction", MODEL_ID, { dtype });
  const loadMs = performance.now() - tLoad0;
  console.log(`model load ${loadMs.toFixed(0)} ms`);

  const tokenizer = extractor.tokenizer;
  const files = (await readdir(README_DIR))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .slice(0, n);

  let windows = 0;
  let tokens = 0;
  let dims = 0;
  const tEmbed0 = performance.now();
  for (const file of files) {
    const raw = await readFile(path.join(README_DIR, file), "utf8");
    const text = cleanReadme(raw) || file;
    const ids = tokenizer.encode(text, { add_special_tokens: false });
    const chunks: string[] = [];
    for (
      let i = 0;
      i < ids.length && chunks.length < MAX_WINDOWS;
      i += WINDOW_TOKENS
    ) {
      chunks.push(tokenizer.decode(ids.slice(i, i + WINDOW_TOKENS)));
      tokens += Math.min(WINDOW_TOKENS, ids.length - i);
    }
    if (chunks.length === 0) chunks.push(file);
    const out = await extractor(chunks, { pooling: "mean", normalize: true });
    const [rows, d] = out.dims as [number, number];
    dims = d;
    const data = out.data as Float32Array;
    const avg = new Float32Array(d);
    for (let r = 0; r < rows; r++)
      for (let j = 0; j < d; j++)
        avg[j] = (avg[j] ?? 0) + (data[r * d + j] ?? 0);
    normaliseInPlace(avg);
    windows += rows;
  }
  const embedMs = performance.now() - tEmbed0;
  const perRepo = embedMs / files.length;
  const extrapolated = perRepo * 1000 + loadMs;

  console.log(`repos ${files.length}, windows ${windows}, tokens ${tokens}`);
  console.log(`dims ${dims}`);
  console.log(`embed ${embedMs.toFixed(0)} ms (${perRepo.toFixed(1)} ms/repo)`);
  console.log(
    `extrapolated 1000 repos ${(extrapolated / 1000).toFixed(1)} s ` +
      `(budget ${BUDGET_MS / 1000} s) -> ${extrapolated <= BUDGET_MS ? "PASS" : "FAIL"}`,
  );
  if (extrapolated > BUDGET_MS) process.exitCode = 1;
}

await main();
