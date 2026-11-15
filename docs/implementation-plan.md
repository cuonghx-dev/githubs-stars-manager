# Implementation Plan: Stars Graph

| | |
|---|---|
| Status | Draft |
| Owner | cuonghx |
| Last updated | 2026-11-15 |
| Related | [Project Brief](./project-brief.md) · [PRD](./prd.md) |

## 1. Purpose

This document turns the [PRD](./prd.md) into an ordered build plan. It defines the module layout, the tasks for each milestone, how each task is verified, and the spikes to run before risky work. Requirement ids (FR-x, NFR-x) refer to the PRD. Task ids are `T<milestone>.<n>`.

Rules for the whole plan:

- Build milestones in order. Each one ends with a working `pnpm data` and a working app.
- Pipeline logic lives in pure functions under `scripts/lib/` with unit tests. Entry scripts (`sync.ts`, `embed.ts`, `build-graph.ts`) only do I/O and wiring.
- `graph.json` is the only contract between pipeline and app. Its zod schema is shared by both sides.

## 2. Decisions for open questions

The PRD defaults are adopted. Implementation consequences:

| PRD | Decision | Consequence |
|---|---|---|
| Q1 | Commit `public/graph.json`, `data/enrichment.json`, `data/manual.yaml`; ignore the rest of `data/` | `.gitignore`: `data/raw/`, `data/embeddings.json`, `data/enrich-todo.json`, `.cache/`, `public/embeddings.bin` |
| Q2 | Local only for M1–M3 | Vite `base` comes from config from day one, so Pages stays a config change (optional task T5.9) |
| Q3 | Include starred forks | `isFork` stored; no special handling in the graph |
| Q4 | Tunables in config only | `config/graph.config.ts` (T0.5) |
| Q5 | Exclude private repos | Filter in `sync` before anything is written (T1.2) |
| Q6 | Star Lists not used in MVP | No task; revisit after M4 |
| Q7 | Keep `all-MiniLM-L6-v2` | Model id lives in config; cluster check on non-English repos in T2.7 |
| Q8 | Hand-edited `data/manual.yaml` | T5.1 |

## 3. Architecture

### 3.1 Pipeline modules (`scripts/`)

| File | Responsibility | FR |
|---|---|---|
| `sync.ts` | Fetch stars and READMEs into `data/raw/` | FR-1–4, FR-11, FR-13 |
| `embed.ts` | Compute and cache embeddings | FR-5 |
| `build-graph.ts` | Signals → edges → clusters → metrics → layout → `public/graph.json` | FR-6, FR-20–29 |
| `enrich-todo.ts` | Write `data/enrich-todo.json` | FR-70 |
| `inspect.ts` | Dev CLI for manual quality checks (clusters, similar, sample) | supports M2/M3 acceptance |
| `lib/gh.ts` | `execa` wrapper for `gh api` / `gh api graphql`; `assertAuth()`; retry with back-off (3 tries, 1/2/4 s) on 5xx, secondary rate limit, network errors | FR-13 |
| `lib/fs-atomic.ts` | `writeJsonAtomic`, `writeTextAtomic` (temp file + `rename`), `readJsonOr(default)` | FR-13 |
| `lib/log.ts` | Per-step summary lines (added/removed/changed, fetched, embedded, edges kept) | FR-13 |
| `lib/readme.ts` | `extractLinks(md)` (raw), `cleanReadme(md)`, `excerpt(clean, 500)` | FR-12, FR-41 |
| `lib/mentions.ts` | URL normalisation and mention index (`owner/repo` + homepage) | FR-28 |
| `lib/embed-text.ts` | Build embedding input text and its hash; token chunking | FR-5 |
| `lib/signals.ts` | `cosine`, `jaccard`, per-pair signal record | FR-20, FR-23 |
| `lib/weights.ts` | Combined weight with semantic rescale and renormalisation of disabled signals | FR-21 |
| `lib/prune.ts` | Top-k per node + threshold + forced edges | FR-22 |
| `lib/clusters.ts` | Seeded Louvain, small-cluster merge, id remap by size, palette | FR-24 |
| `lib/tfidf.ts` | Cluster labels | FR-25 |
| `lib/metrics.ts` | Degree, weighted degree, betweenness, bridge score | FR-26 |
| `lib/layout.ts` | Seeded initial positions, ForceAtlas2, ring for isolates | FR-27 |
| `lib/deps.ts` | Dependency resolution (manifests → starred repos) | FR-7 |
| `lib/rng.ts` | Seeded PRNG (mulberry32) used by Louvain and layout | NFR-4 |
| `lib/serialize.ts` | Stable sort and rounding before write | NFR-4 |
| `config/graph.config.ts` | All tunables (PRD §7.2) with a typed default export | — |

### 3.2 Shared schema

`src/lib/graph-schema.ts` holds the zod schema for `GraphFile` (PRD §5.1) and exports inferred TS types. `build-graph` validates its output before writing. The app validates on load and shows the error state on failure or unknown `version` (FR-37). Enrichment and manual schemas live in `scripts/lib/schemas.ts` (pipeline only).

### 3.3 App modules (`src/`)

| Path | Responsibility |
|---|---|
| `app/App.tsx`, `app/Layout.tsx` | Shell: header, left nav, canvas, detail panel, timeline bar; responsive collapse (PRD §6) |
| `lib/load-graph.ts` | Fetch `${import.meta.env.BASE_URL}graph.json`, validate, build a `graphology` instance and lookup maps |
| `lib/store.ts` | `zustand` store: selection, hover, filters, active view, theme, walk history. Sigma reducers read it without React re-renders |
| `features/graph/` | `GraphCanvas` (`@react-sigma/core`), node/edge reducers (hover, focus, filter), `ClusterLabels` overlay, camera helpers |
| `features/detail/` | `DetailPanel`, `SimilarList`, `reasons.ts` (edge → human reason string) |
| `features/search/` | `SearchBox` (MiniSearch), `Filters` |
| `features/discovery/` | Clusters, Bridges, Forgotten, Duplicates, Path views; random walk |
| `features/timeline/` | `TimelineSlider` |
| `components/ui/` | shadcn/ui components |

### 3.4 Intermediate file shapes

PRD §5.2 lists the files. Shapes not fixed by the PRD:

```ts
// data/raw/stars.json
type StarsFile = {
  version: 1;
  user: string;
  lastSyncAt: string;
  repos: RawRepo[];               // FR-2 fields, sorted by nameWithOwner
};
type RawRepo = { /* FR-2 fields */ } & {
  readme: { status: "ok" | "missing"; fetchedForPushedAt: string };
};
```

The README file path is derived from `nameWithOwner`, but cache lookups use `githubId`, so a rename moves the file instead of re-fetching it (FR-4).

## 4. Cross-cutting rules

- **Determinism (NFR-4).** Nodes sorted by `id`; each edge stored with `source < target` and the edge list sorted by `(source, target)`; weights and cosines rounded to 4 decimals, coordinates to 2. Louvain and layout use `lib/rng.ts` with seeds from config. Object keys are written in schema order. A golden test (T1.7) enforces byte-identical output apart from `generatedAt`.
- **Atomic writes (FR-13).** Every file under `data/` and `public/` is written through `lib/fs-atomic.ts`. `embed` also flushes the cache every 100 vectors so an interrupted run keeps its progress.
- **No network in tests (NFR-10).** `lib/gh.ts` takes an injectable `exec` function; tests pass a fake.
- **Budgets as checks.** `build-graph` warns when `graph.json` > 3 MB (NFR-2) and asserts that non-forced edges ≤ k × node count (M2 done-check).
- **Network and cost (NFR-5, NFR-6).** The pipeline talks only to GitHub (through `gh`) and to Hugging Face for the first model download. No paid APIs, no analytics in the app.
- **Portability (NFR-7).** Vite `base` comes from config and all asset paths are relative, so the static build works under a GitHub Pages sub-path.
- **Pipeline time (NFR-3).** `pnpm data` prints per-step timings; checked at the end of M2 (first run < 5 min, incremental < 1 min).
- **Commits.** Conventional Commits, scopes `pipeline`, `app`, `config`, `docs`.

## 5. Milestones and tasks

Size: S ≤ half a day, M ≈ 1 day, L ≈ 2–3 days.

### M0: Scaffold

| Task | Work | Size |
|---|---|---|
| T0.1 | `git init`; `.gitignore` (§2); `.nvmrc` (Node 20); `package.json` with `"type": "module"`, `engines`, and the scripts from PRD §7.1 | S |
| T0.2 | TypeScript strict; `tsconfig.app.json` (`src/`) and `tsconfig.node.json` (`scripts/`, `config/`) referenced from the root `tsconfig.json` | S |
| T0.3 | Vite + React + TS; Tailwind CSS; `shadcn init`; light/dark tokens | S |
| T0.4 | Vitest (node environment for `scripts/`), ESLint + Prettier, `tsx` for scripts | S |
| T0.5 | `config/graph.config.ts`: weights, semantic range `[0.3, 0.9]`, `k = 6`, `minWeight = 0.15`, Louvain `resolution` + seed, `minClusterSize = 3`, FA2 iterations (500) + seed, duplicate threshold 0.85, forgotten rules, `includePrivate = false`, README concurrency 8, model id, `base` | S |
| T0.6 | `src/lib/graph-schema.ts` (zod) + a schema test on a hand-written fixture | S |

**Done when:** `pnpm dev` shows the empty state ("run `pnpm data`"), `pnpm test` and `pnpm build` pass.

### M1: First graph

| Task | Work | FR | Size |
|---|---|---|---|
| T1.1 | `lib/gh.ts`, `lib/fs-atomic.ts`, `lib/log.ts`; `assertAuth()` runs `gh auth status` and exits with a clear message | FR-13 | M |
| T1.2 | `sync`: page `viewer.starredRepositories(first: 100, after: $cursor, orderBy: {field: STARRED_AT, direction: DESC})`, reading `starredAt` from edges and FR-2 fields from nodes (`languages(first: 3, orderBy: {field: SIZE, direction: DESC})`, `repositoryTopics(first: 20)`, `licenseInfo { spdxId }`). Drop `isPrivate` repos unless `includePrivate`. Write `stars.json` | FR-1, FR-2, FR-11 | M |
| T1.3 | README fetch with `p-limit(8)` and the raw `Accept` header; 404 → `missing`. Incremental: compare `pushedAt` by `githubId`; delete READMEs (and later embeddings) of removed stars; move files of renamed repos; `--full` ignores the cache | FR-3, FR-4 | M |
| T1.4 | `lib/readme.ts`: `extractLinks` on raw markdown + HTML `href`s; `cleanReadme` drops HTML, images, badge lines, fenced/indented code, tables, link targets; collapses whitespace. Unit tests on fixture READMEs | FR-12 | M |
| T1.5 | `lib/mentions.ts`: normalise `github.com/<owner>/<repo>` (case, `.git`, `/tree/…`, `/blob/…`, `#…`) and homepages (scheme, `www.`, trailing `/`); skip self-links and homepages that are just a GitHub repo URL. Tests | FR-28 | S |
| T1.6 | `build-graph` v1: topic, owner, mention signals; `lib/weights.ts` renormalises over enabled signals (M1: topic/mention/owner → 0.526/0.395/0.079); `lib/prune.ts` top-k + threshold + forced edges. All nodes get cluster `-1` until M2 | FR-20–23 | M |
| T1.7 | `lib/layout.ts` (seeded positions → FA2 with `inferSettings` → isolates on an outer ring), `lib/serialize.ts`, schema validation, atomic write. Golden test on the fixture: two runs → identical bytes apart from `generatedAt` | FR-6, FR-27, NFR-4 | M |
| T1.8 | App: `load-graph.ts`, loading / empty / error states, header with `generatedAt` + count, `GraphCanvas` with precomputed x/y, pan/zoom, hover highlight of node + neighbours, node size = log-scaled stars | FR-30, FR-31, FR-33, FR-37 | M |
| T1.9 | `pnpm data` = `sync && build-graph` (embed is added in M2) | FR-10 | S |

**Done when:** PRD §9 M1 checks pass:

```bash
pnpm data
jq '.nodes | length' public/graph.json
gh api user/starred --paginate --jq '.[] | select(.private | not) | .full_name' | wc -l   # must match
pnpm build-graph && cp public/graph.json /tmp/g1.json && pnpm build-graph \
  && diff <(jq 'del(.generatedAt)' /tmp/g1.json) <(jq 'del(.generatedAt)' public/graph.json)   # no diff
```

### M2: Meaningful clusters

Start with spike S1 (§7).

| Task | Work | FR | Size |
|---|---|---|---|
| T2.1 | `embed`: `pipeline("feature-extraction", modelId)` from `@huggingface/transformers`, model cache in `.cache/models`. Input per FR-5 (`lib/embed-text.ts`). Tokenise, split into windows of ≤ 254 content tokens (+ CLS/SEP), max 4; embed each with mean pooling + normalise; average and re-normalise. Cache key `sha256(model + text)`; only changed repos are embedded; vectors of removed repos are deleted | FR-5 | L |
| T2.2 | Semantic signal: dense cosine over all pairs (≈ 500k dot products of 384 dims, well under a second); rescale `[0.3, 0.9] → [0, 1]`; full weight formula. Prune keeps a per-node top-k heap so memory stays O(n·k) | FR-20–23 | M |
| T2.3 | `lib/clusters.ts`: Louvain (weighted, `rng` from `lib/rng.ts`, `resolution` from config); clusters < 3 → `-1`; remaining ids by size desc, ties by smallest member id; colours from a fixed colour-blind-safe palette checked in both themes (cycle with a lightness shift past its length) | FR-24 | M |
| T2.4 | `lib/tfidf.ts`: one document per cluster (member topics + descriptions), stop words + generic terms removed, top 3 terms → label; `-1` is labelled "Unclustered" | FR-25 | M |
| T2.5 | Degree and weighted degree in `lib/metrics.ts` | FR-26 (part) | S |
| T2.6 | App: cluster colours; `ClusterLabels` overlay drawn at cluster centroids with `sigma.graphToViewport`, updated on camera events and shown only when zoomed out; node labels via sigma's label threshold, plus hover and selection | FR-31, FR-32 | M |
| T2.7 | `scripts/inspect.ts clusters` prints each cluster with label and members, for the manual 80% check. Note how non-English repos cluster (Q7) | — | S |
| T2.8 | `pnpm data` = `sync && embed && build-graph` | FR-10 | S |

**Done when:** cluster labels make sense for ≥ 80% of repos (manual check with `inspect clusters`), the non-forced-edge assertion holds, and an incremental `pnpm data` with no changes takes < 1 min.

### M3: Daily explorer (MVP)

| Task | Work | FR / NFR | Size |
|---|---|---|---|
| T3.1 | App shell from PRD §6 with shadcn components; narrow screens: nav → menu, detail → bottom sheet | — | M |
| T3.2 | `lib/store.ts` (zustand) and reducer wiring: canvas reads selection/hover/filter state through refs and calls `sigma.refresh()` | — | S |
| T3.3 | Focus mode: on select, compute 1-hop and 2-hop sets; reducers set full / dimmed / faded opacity; `Esc` clears | FR-34 | M |
| T3.4 | Detail panel: metadata, links, README excerpt, cluster chip that filters to that cluster | FR-40, FR-41, FR-43 | M |
| T3.5 | `reasons.ts` + `SimilarList`: neighbours sorted by weight, reason from signals, e.g. `README similarity 0.78 · shared topics: react, state · mentions`. Unit tests | FR-42 | S |
| T3.6 | Search: MiniSearch over name, owner, description, topics (prefix + fuzzy 0.2, name boosted); selecting a result animates the camera to the node and selects it | FR-50 | M |
| T3.7 | Filters: language and cluster multi-select, archived include/exclude/only, starred date range; hide vs fade toggle; "no results" state with "clear filters" | FR-51 | M |
| T3.8 | Cluster overview view: size, label, top languages, top 5 repos by stars; clicking filters and fits the camera | FR-66 | S |
| T3.9 | Theme: system default + manual override persisted in `localStorage`; sigma label and edge colours read from CSS tokens | NFR-8 | S |
| T3.10 | Shortcuts `/`, `Esc`, `f`, `?` and a shortcut dialog | FR-38 (P0) | S |
| T3.11 | Keyboard-only pass over list views (search results, clusters, similar list) and WCAG AA contrast check | NFR-9 | S |
| T3.12 | Performance pass: `performance.mark` from navigation to first sigma render; check payload size | NFR-1, NFR-2 | S |
| T3.13 | `inspect sample --n 20 --seed <s>` writes a markdown checklist of 20 repos × top-5 similar for the relevance check | — | S |

**Done when:** time to interactive < 2 s with the real data, `graph.json` < 3 MB, and the 20-repo sample has ≥ 3/5 relevant on average.

### M4: Discovery toolkit

Start with spike S2 (§7).

| Task | Work | FR | Size |
|---|---|---|---|
| T4.1 | Betweenness (`graphology-metrics`, edge distance `1 − w + 1e-6`) and bridge score; rounded | FR-26 | S |
| T4.2 | Duplicates: all pairs with cosine ≥ 0.85, sorted, written to `duplicates` | FR-63 | S |
| T4.3 | Dependencies: `dependencyGraphManifests` if S2 succeeds, else the manifest fallback via batched GraphQL `object(expression: "HEAD:<file>") { ... on Blob { text } }` (about 25 repos per query, aliased) for `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`. Match rules from FR-7; cache in `data/raw/deps.json` keyed by `githubId` + `pushedAt`; enable the dependency weight | FR-7, FR-20 | L |
| T4.4 | Edge thickness by weight; mention/dependency edges get a distinct colour or curve (`@sigma/edge-curve`); archived nodes hollow (`@sigma/node-border`) | FR-35, FR-36 | M |
| T4.5 | Bridges view: top 20 by betweenness / bridge score with the clusters each one connects | FR-60 | S |
| T4.6 | Path finder: two search pickers, `graphology-shortest-path` Dijkstra with cost `1 − w + 1e-6`, path highlighted, steps listed with reasons, "not connected" message | FR-61 | M |
| T4.7 | Forgotten stars: rules from config, sortable table | FR-62 | S |
| T4.8 | Duplicates view: pairs with cosine, link to select either side | FR-63 | S |
| T4.9 | Timeline slider with play; shares one date-range state with the starred-date filter | FR-64, FR-54 | M |
| T4.10 | Random walk: weighted-random neighbour, history stack, shortcuts `r`, `[`, `]` | FR-65, FR-38 | S |
| T4.11 | URL state: encode filters, selection and view in the query string (`replaceState`); restore on load. Unit-test the codec | FR-52 | M |

**Done when:** every view works on the real data, a bookmarked URL restores the same view, and the first session finds ≥ 10 forgotten or duplicate stars.

### M5: Enrichment and manual data

| Task | Work | FR | Size |
|---|---|---|---|
| T5.1 | `data/manual.yaml` (`yaml` + zod): tags (searchable, shown in panel), labelled edges, `hide`. Invalid entries reported, not fatal | FR-9, FR-29 | M |
| T5.2 | `enrich:todo`: repos without enrichment, with README paths | FR-70 | S |
| T5.3 | Enrichment schema + merge; unknown keys and non-starred `alternativesTo` reported and dropped; `alternativesTo` → manual edges with weight `max(w, 0.5)` | FR-8, FR-72, FR-29 | M |
| T5.4 | Cluster labels from enrichment: top 3 member `concepts` by TF-IDF across clusters; replace TF-IDF labels when ≥ half the members are enriched | FR-25 | S |
| T5.5 | `docs/enrichment.md`: prompt for Claude Code (batch size, schema, append rules, validation command) | FR-71 | S |
| T5.6 | Panel shows summary, category, concepts | FR-44 | S |
| T5.7 | Concept layer: concept nodes linked to repos, toggleable, placed near the centroid of their repos | FR-73 | M |
| T5.8 | Optional: semantic search (`public/embeddings.bin`, in-browser model, off by default) | FR-53 | L |
| T5.9 | Optional: GitHub Pages deploy of the static build with the committed `graph.json` | Q2 | S |

**Done when:** `docs/enrichment.md` exists, a full enrichment pass validates with zero schema errors, and enrichment labels show in the UI.

## 6. Testing

| Level | Scope | Where |
|---|---|---|
| Unit | README cleaning, link extraction, mentions, embedding text + chunking (token ids, no model), cosine/Jaccard, weight renormalisation, top-k pruning, cluster remap, TF-IDF, schemas, reasons, URL codec | `scripts/lib/*.test.ts`, `src/**/*.test.ts` |
| Golden | `build-graph` on fixtures (12 repos, READMEs, hand-made 384-dim vectors) → snapshot `graph.json`; run twice to check byte equality | `scripts/__fixtures__/`, `scripts/build-graph.test.ts` |
| Contract | Pipeline output and app loader both pass `graph-schema.ts` | schema test |
| Manual | Milestone done-checks (§5), `inspect` commands, browser pass in light and dark mode | — |

No network in any automated test (NFR-10). `gh` and the embedding model are replaced by fakes.

## 7. Spikes

| Id | When | Question | Exit criterion |
|---|---|---|---|
| S1 | Start of M2 | Does `@huggingface/transformers` run `all-MiniLM-L6-v2` under Node 20 on macOS arm64, where is the model cached, and how fast is it? | 100 READMEs embedded; time extrapolated to 1,000 fits the 5 min budget |
| S2 | Start of M4 | Is GraphQL `dependencyGraphManifests` usable through `gh api graphql` with the preview header, and does it resolve packages to repositories? | Works for 5 known repos → use it; otherwise use the manifest fallback |
| S3 | Start of M2 (T2.6) | Cluster-label overlay on sigma v3 with `@react-sigma/core`: stays aligned during pan/zoom at 50 fps | Overlay prototype with 1,000 nodes |

## 8. Risks

| Risk | Mitigation |
|---|---|
| ForceAtlas2 output differs across Node versions | Rounding in `serialize.ts`; Node pinned by `.nvmrc`; golden test |
| GitHub rate limits during first sync | REST README calls are about 1,000 per run (limit 5,000/h); GraphQL batching for manifests; back-off in `gh.ts` |
| Weak embeddings for short READMEs | Fallback input from FR-5; topic and mention signals still produce edges |
| Hairball on dense clusters | Top-k, `minWeight`, focus mode; tune in config |
| Scope creep in the UI | P1/P2 features wait for their milestone; M3 is the MVP cut |

## 9. Critical path

```
M0 ─► T1.1 ─► T1.2 ─► T1.3 ─► T1.6 ─► T1.7 ─► T1.8   (first graph)
                  └► T1.4 ─► T1.5 ─┘
S1 ─► T2.1 ─► T2.2 ─► T2.3 ─► T2.4 ─► T2.6            (clusters)
T3.1 ─► T3.2 ─► T3.3/T3.4/T3.6 ─► T3.12               (MVP)
S2 ─► T4.3 ;  T4.1 ─► T4.5 ;  T4.6, T4.9, T4.11 independent
T5.3 ─► T5.4/T5.6/T5.7 ;  T5.1 independent
```

M4 and M5 tasks are mostly independent and can be done in any order inside their milestone.
