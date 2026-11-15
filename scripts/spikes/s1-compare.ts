// Spike S1 follow-up: how close are q8 vectors to fp32 vectors for
// Xenova/all-MiniLM-L6-v2? Embeds the first N cleaned READMEs (first 254
// tokens only) with both dtypes and reports the per-repo cosine between them,
// plus how well the q8 pairwise similarities track the fp32 ones.
//
// Usage: pnpm tsx scripts/spikes/s1-compare.ts [--n 50]

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { env, pipeline } from "@huggingface/transformers";
import { cleanReadme } from "../lib/readme.ts";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const README_DIR = path.resolve("data/raw/readmes");

async function embedAll(
  dtype: "fp32" | "q8",
  texts: string[],
): Promise<Float32Array[]> {
  const extractor = await pipeline("feature-extraction", MODEL_ID, { dtype });
  const out: Float32Array[] = [];
  for (const t of texts) {
    const r = await extractor(t, { pooling: "mean", normalize: true });
    out.push(Float32Array.from(r.data as Float32Array));
  }
  return out;
}

function dot(a: Float32Array | undefined, b: Float32Array | undefined): number {
  if (!a || !b) throw new Error("missing vector");
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

async function main(): Promise<void> {
  const i = process.argv.indexOf("--n");
  const n = i >= 0 ? Number(process.argv[i + 1]) : 50;
  env.cacheDir = path.resolve(".cache/models");

  const files = (await readdir(README_DIR))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .slice(0, n);
  const texts = await Promise.all(
    files.map(async (f) => {
      const raw = await readFile(path.join(README_DIR, f), "utf8");
      return (cleanReadme(raw) || f).slice(0, 2000);
    }),
  );

  const a = await embedAll("fp32", texts);
  const b = await embedAll("q8", texts);

  const self = a.map((v, k) => dot(v, b[k]));
  let maxPairErr = 0;
  let sumPairErr = 0;
  let pairs = 0;
  for (let x = 0; x < a.length; x++)
    for (let y = x + 1; y < a.length; y++) {
      const err = Math.abs(dot(a[x], a[y]) - dot(b[x], b[y]));
      maxPairErr = Math.max(maxPairErr, err);
      sumPairErr += err;
      pairs++;
    }

  console.log(`repos ${a.length}`);
  console.log(
    `fp32·q8 self cosine: min ${Math.min(...self).toFixed(4)} ` +
      `mean ${(self.reduce((s, v) => s + v, 0) / self.length).toFixed(4)}`,
  );
  console.log(
    `pairwise cosine |fp32 - q8|: mean ${(sumPairErr / pairs).toFixed(4)} ` +
      `max ${maxPairErr.toFixed(4)} over ${pairs} pairs`,
  );
}

await main();
