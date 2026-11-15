# Spike S1: transformers.js MiniLM on Node / macOS arm64

Question (implementation-plan §7): does `@huggingface/transformers` run
`all-MiniLM-L6-v2` under Node 20 on macOS arm64, where is the model cached,
and how fast is it? Exit criterion: 100 READMEs embedded, and the time
extrapolated to 1,000 repos fits the 5 min budget.

**Answer: yes, with `dtype: "q8"`.** fp32 works but does not fit the budget
reliably on this machine.

## Setup

- `@huggingface/transformers` 4.3.2 (Node backend: `onnxruntime-node`, native
  CPU, installed by its postinstall script; no extra system deps).
- Model id `Xenova/all-MiniLM-L6-v2`, `pipeline("feature-extraction")`,
  `pooling: "mean"`, `normalize: true`, 384 dims.
- Hardware: Apple M1, 8 cores. The machine was heavily loaded during every
  run (load average 12–15 from other agents), so timings are pessimistic and
  noisy (the same fp32 run took 51 s and 75 s).
- Input: the first 100 cached READMEs in `data/raw/readmes` (sorted by file
  name), cleaned with `cleanReadme`, windowed as T2.1 specifies: ≤ 254
  content tokens per window, at most 4 windows, mean pooling + normalise per
  window, then averaged and re-normalised. 100 repos → 369 windows, 91,116
  tokens.

Script: `pnpm tsx scripts/spikes/s1-embed.ts --n 100` (`S1_DTYPE=q8|fp32`).

## Model cache

Setting `env.cacheDir = ".cache/models"` before `pipeline()` stores the model
in the repo-local cache (already gitignored):

```
.cache/models/Xenova/all-MiniLM-L6-v2/{config,tokenizer,tokenizer_config}.json
.cache/models/Xenova/all-MiniLM-L6-v2/onnx/model.onnx            (fp32, ~87 MB)
.cache/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx  (q8)
```

First run downloads from the Hugging Face hub (cold load ~4 s); later runs
load from disk in 0.2–1.6 s. Without `env.cacheDir` the library caches inside
`node_modules/@huggingface/transformers/.cache`, which a reinstall wipes.

## Results (100 READMEs)

| Node | dtype | ms / repo | Extrapolated 1,000 repos | Budget 300 s |
|---|---|---|---|---|
| v24.22.1 (`.nvmrc`) | fp32 | 513 (cold), 750 (warm, more load) | 517 s / 751 s | FAIL |
| v24.22.1 | q8 | 250 | 252 s | PASS |
| v20.20.2 | fp32 | 413 | 413 s | FAIL |
| v20.20.2 | q8 | 153 | 153 s | PASS |

Extrapolation = ms/repo × 1,000 + model load. The repo currently has 541
READMEs, so a full first run is about half of the extrapolated time; the
incremental cache in T2.1 means later runs embed only changed repos.

## q8 vs fp32 quality

`pnpm tsx scripts/spikes/s1-compare.ts --n 50` embeds 50 READMEs (first
window) with both dtypes:

- Same-repo cosine fp32·q8: min 0.9869, mean 0.9924.
- Pairwise cosine difference |fp32 − q8| over 1,225 pairs: mean 0.0106,
  max 0.0440.

The semantic signal rescales `[0.3, 0.9] → [0, 1]` (T2.2), so a mean shift of
0.01 is about 1.8% of the range. That is small next to the other weight
terms and the pruning thresholds.

## Recommendation for T2.1

1. Use `pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" })`
   and set `env.cacheDir = ".cache/models"` before the first call.
2. Put `dtype` in the cache key next to the model id
   (`sha256(model + dtype + text)`), so switching dtype re-embeds.
3. Embed all windows of one repo in a single `extractor(chunks, …)` call (as
   the spike does); it returns `[windows, 384]`.
4. Tokenise with `extractor.tokenizer.encode(text, { add_special_tokens: false })`
   and decode each 254-token slice back to text for the window; the pipeline
   adds CLS/SEP itself.

## Open points

- Timings were taken on a loaded machine; an idle run should be faster. Re-time
  during T2.1 with the full set to confirm the < 5 min first run.
- Node 24 (pinned in `.nvmrc`) was slower than Node 20 in these runs, but the
  load differed between runs, so this is not a reliable comparison.
