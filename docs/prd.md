# PRD: Stars Graph

| | |
|---|---|
| Status | Draft |
| Owner | cuonghx |
| Last updated | 2026-11-15 |
| Related | [Project Brief](./project-brief.md) · [Implementation Plan](./implementation-plan.md) |

## 1. Overview

Stars Graph turns a single user's GitHub stars (fewer than 1,000) into an interactive graph built for discovery. An offline Node pipeline fetches the stars, computes relationships, and writes one `graph.json`. A static React app renders it with sigma.js. See the [Project Brief](./project-brief.md) for motivation, goals, and non-goals.

## 2. User stories

| ID | As the user, I want to… | So that… |
|---|---|---|
| US-1 | sync my stars with one command | the graph reflects my current stars |
| US-2 | see all stars as a clustered graph with labels | I understand the shape of my interests |
| US-3 | click a repo and see its details and neighbours | I can explore from any starting point |
| US-4 | see *why* two repos are connected | I trust the links and learn from them |
| US-5 | search by name, topic, or free text | I can jump to a repo or area quickly |
| US-6 | focus on one repo and dim everything else | I can read a dense neighbourhood |
| US-7 | find repos that bridge two clusters | I discover links between areas |
| US-8 | find the path between two repos | I see how two areas connect |
| US-9 | list forgotten, isolated, or archived stars | I can revisit or clean up |
| US-10 | filter by time starred, language, cluster | I can slice the graph |
| US-11 | jump to a random neighbour repeatedly | I rediscover stars by chance |
| US-12 | enrich repos with Claude Code on demand | labels and concepts get better without paid APIs |

## 3. Functional requirements

Priority: **P0** is MVP (M1–M3), **P1** is the full discovery toolkit (M4), **P2** is optional (M5+).

### 3.1 Data pipeline

| ID | Requirement | Priority |
|---|---|---|
| FR-1 | `sync` fetches all starred repos for the authenticated `gh` user via GraphQL `viewer.starredRepositories`, including `starredAt`. | P0 |
| FR-2 | For each repo, store: GitHub node `id`, `nameWithOwner`, `description`, `url`, `homepageUrl`, `primaryLanguage`, `languages` (top 3), `repositoryTopics`, `stargazerCount`, `forkCount`, `isArchived`, `isFork`, `isPrivate`, `pushedAt`, `createdAt`, `licenseInfo`, `starredAt`. | P0 |
| FR-3 | Fetch README text with `gh api repos/{owner}/{repo}/readme -H "Accept: application/vnd.github.raw"` (GitHub resolves `README*` on the default branch). Run with bounded concurrency (default 8). A 404 means "no README" and is cached as such. Store the text under `data/raw/readmes/<owner>__<repo>.md`. | P0 |
| FR-4 | Sync is incremental: skip README re-fetch when `pushedAt` has not changed since the last sync. Removed stars are dropped together with their README file and cached embedding. Caches are keyed by GitHub node `id`, so a renamed or transferred repo keeps its cache. `--full` forces a full re-fetch. | P0 |
| FR-5 | `embed` computes a 384-dim embedding per repo using `Xenova/all-MiniLM-L6-v2` (transformers.js) on `description + topics + cleaned README (first ~2,000 chars)`. The model truncates input at 256 word pieces, so the text is split into chunks of ≤ 256 tokens (max 4 chunks) and the L2-normalised chunk vectors are averaged. If there is no README, the input is `name + description + topics`. Results are cached by a hash of the input text and the model id. | P0 |
| FR-6 | `build-graph` produces `public/graph.json` (schema in §5). | P0 |
| FR-7 | Resolve dependencies between starred repos. Preferred source: GitHub's dependency graph via GraphQL `dependencyGraphManifests` (resolves each package to a repository; needs a preview header, to be verified in an M4 spike). Fallback: parse `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml` at the repo root and match a package to a starred repo when the package name equals the repo name (case-insensitive) or, for Go, the module path is `github.com/<owner>/<repo>`. Keep only dependencies that are also starred. No package registry calls (NFR-5). | P1 |
| FR-8 | Merge `data/enrichment.json` when present (schema in §5.3). | P2 |
| FR-9 | Merge `data/manual.yaml` for user tags and labelled edges (schema in §5.4). | P2 |
| FR-10 | `pnpm data` runs sync → embed → build in order. Each step is also a separate command (§7.1). | P0 |
| FR-11 | Private repos are excluded by default (`includePrivate: false` in config), so a published `graph.json` never leaks private repo names or README text. | P0 |
| FR-12 | README cleaning (used by FR-5 and FR-41): drop HTML tags, images, badge lines, code blocks, tables, and link targets (keep link text); collapse whitespace. The same function is used for embedding input and the excerpt. | P0 |
| FR-13 | Pipeline robustness: check `gh auth status` before syncing and fail with a clear message; retry transient GitHub errors with back-off; write every output file atomically (temp file + rename) so an interrupted run never leaves a half-written cache; log a per-step summary (repos added/removed/changed, READMEs fetched, embeddings computed, edges kept). | P0 |

### 3.2 Graph construction

| ID | Requirement | Priority |
|---|---|---|
| FR-20 | Edge signals per repo pair (i, j): **semantic** = cosine similarity of embeddings; **topic** = Jaccard of topic sets (0 when either set is empty); **mention** = 1 if either README links to the other (FR-28); **dependency** = 1 if either depends on the other; **owner** = 1 if same owner. Edges are undirected. | P0 (dependency P1) |
| FR-21 | Combined weight: `w = 0.55·semantic' + 0.20·topic + 0.15·mention + 0.07·dependency + 0.03·owner`, where `semantic'` rescales cosine from `[0.3, 0.9]` to `[0, 1]` (clamped). Weights live in one config file. When a signal is disabled (e.g. no embeddings in M1, no dependencies before M4), the remaining weights are renormalised to sum to 1, so the `w ≥ 0.15` threshold keeps the same meaning. | P0 |
| FR-22 | Rank each node's candidate edges by `w`. Keep an edge only if it is in the top-k (default k = 6) of either endpoint **and** `w ≥ 0.15`. **mention**, **dependency**, and **manual** edges are always kept ("forced" edges). | P0 |
| FR-23 | Each edge stores its signal breakdown so the UI can explain it (FR-42). `semantic` is stored as the raw cosine, not the rescaled value. | P0 |
| FR-24 | Run Louvain community detection (`graphology-communities-louvain`, weighted, seeded `rng`, `resolution` in config). Clusters with fewer than 3 members are merged into an "Unclustered" group with id `-1`. Other cluster ids are assigned by size, largest first, and colours come from a fixed palette in id order, so ids and colours stay stable across runs with the same input. | P0 |
| FR-25 | Label each cluster with its top 3 TF-IDF terms from member topics + descriptions (stop words and generic terms such as "library", "awesome", "github" removed). Enrichment labels override when present. | P0 |
| FR-26 | Compute per-node metrics: degree, weighted degree, betweenness centrality, and "bridge score" (number of distinct neighbour clusters). | P1 |
| FR-27 | Compute a ForceAtlas2 layout at build time (`graphology-layout-forceatlas2`, ~500 iterations) from seeded random initial positions, and store x/y on each node. Isolated nodes (degree 0) are placed on a ring outside the main layout instead of drifting. | P0 |
| FR-28 | Mention detection: a README mentions repo B if it contains a link to `github.com/<owner>/<repo>` of B (case-insensitive, ignoring a trailing `.git`, `/tree/...`, `/blob/...`, or fragment) or to B's `homepageUrl`. Self-links are ignored. Links are extracted before cleaning (FR-12). | P0 |
| FR-29 | Labelled edges from `data/manual.yaml` and enrichment `alternativesTo` become edges with a `manual` signal (label `alternative-of`, `used-with`, …). They are forced edges and their weight is `max(w, 0.5)`. | P2 |

### 3.3 Graph view

| ID | Requirement | Priority |
|---|---|---|
| FR-30 | Render all nodes and edges with sigma.js using the precomputed layout. Pan and zoom work. | P0 |
| FR-31 | Node colour = cluster; node size = log-scaled `stargazerCount` (toggle: weighted degree). | P0 |
| FR-32 | Cluster labels show at their centroids when zoomed out. Node labels show on zoom, hover, or selection. | P0 |
| FR-33 | Hover a node to highlight it and its direct neighbours. | P0 |
| FR-34 | Click a node to select it, open the side panel, and enter focus mode: 1-hop neighbours full opacity, 2-hop dimmed, rest faded. Esc clears it. | P0 |
| FR-35 | Edge thickness reflects weight. Mention and dependency edges use a distinct style. | P1 |
| FR-36 | Archived repos render with a hollow or grey style. | P1 |
| FR-37 | The header shows when the data was generated (`generatedAt`) and the repo count. If `graph.json` is missing or invalid, the app shows an empty state telling the user to run `pnpm data`. | P0 |
| FR-38 | Keyboard shortcuts: `/` focus search, `Esc` clear selection/close panel, `f` fit graph to screen, `r` random walk step (FR-65), `[` / `]` random-walk history back/forward, `?` show shortcut list. | P0 (`r`, `[`, `]` P1) |

### 3.4 Side panel (repo detail)

| ID | Requirement | Priority |
|---|---|---|
| FR-40 | Show name, owner, description, language, topics, stars, last push, starred date, license, archived flag, and links to GitHub and homepage. | P0 |
| FR-41 | Show a README excerpt (first ~500 chars, cleaned markdown). | P0 |
| FR-42 | List "Similar repos" sorted by weight, each with a reason built from the edge's signal breakdown (e.g. "README similarity 0.78 · shared topics: react, state"). | P0 |
| FR-43 | Show the cluster name, with a click action to filter to that cluster. | P0 |
| FR-44 | Show enrichment summary, category, and concepts when available. | P2 |

### 3.5 Search and filters

| ID | Requirement | Priority |
|---|---|---|
| FR-50 | Fuzzy search box over name, owner, description, and topics (MiniSearch or Fuse.js). Selecting a result centres and selects the node. Shortcut: `/`. | P0 |
| FR-51 | Filters: language (multi-select), cluster (multi-select), archived (include/exclude/only), starred date range. Nodes that don't match are hidden or faded (toggle). | P0 |
| FR-52 | Filter state is stored in the URL query string so views can be bookmarked. | P1 |
| FR-53 | Semantic search: embed the query in the browser with the same model and rank repos by cosine. Off by default because of model download size. Repo vectors ship as a separate `public/embeddings.bin` (Float32, ~1.5 MB for 1,000 repos) loaded only when the feature is turned on. | P2 |
| FR-54 | The timeline slider (FR-64) and the starred-date filter (FR-51) control the same date range; moving one updates the other. | P1 |

### 3.6 Discovery tools

| ID | Requirement | Priority |
|---|---|---|
| FR-60 | **Bridges** view: top 20 nodes by betweenness/bridge score, with the clusters each one connects. | P1 |
| FR-61 | **Path finder**: pick repo A and B, then highlight the weighted shortest path (cost = `1 − w`) and list the steps with reasons. If A and B are not connected, say so instead of showing an empty path. | P1 |
| FR-62 | **Forgotten stars**: repos starred more than 1 year ago with degree ≤ 1, or archived, or last push older than 2 years. Sortable list. | P1 |
| FR-63 | **Duplicates**: pairs with semantic similarity ≥ 0.85, shown as "possibly overlapping" candidates. Computed at build time over **all** pairs (not only kept edges) and written to `graph.json` as `duplicates`. | P1 |
| FR-64 | **Timeline slider**: show only repos starred up to date T, with play/animate. | P1 |
| FR-65 | **Random walk**: a button that moves selection to a weighted-random neighbour, with history back/forward. | P1 |
| FR-66 | **Cluster overview**: list clusters with size, label, top languages, and top 5 repos by stars. | P0 |

### 3.7 Claude Code enrichment (optional)

| ID | Requirement | Priority |
|---|---|---|
| FR-70 | `pnpm enrich:todo` writes `data/enrich-todo.json` listing repos missing from `enrichment.json` (with paths to their raw READMEs). | P2 |
| FR-71 | Document a prompt in `docs/enrichment.md` that tells Claude Code to process the todo list in batches and append valid entries to `enrichment.json`. | P2 |
| FR-72 | `build-graph` validates `enrichment.json` against a schema (zod) and reports invalid entries without failing the build. | P2 |
| FR-73 | Enrichment `concepts` become extra concept nodes (toggleable layer) linked to repos. | P2 |

## 4. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | **Performance:** time to interactive < 2 s for 1,000 nodes / ~4,000 edges on a modern laptop. Interactions stay at ≥ 50 fps. |
| NFR-2 | **Payload:** `graph.json` < 3 MB uncompressed. Embeddings are **not** shipped to the client unless FR-53 is enabled. |
| NFR-3 | **Pipeline time:** first full run < 5 min; incremental run < 1 min. |
| NFR-4 | **Determinism:** same input produces the same graph and layout (fixed seeds). |
| NFR-5 | **Privacy:** no third-party network calls except GitHub (pipeline) and the Hugging Face model download (first run). |
| NFR-6 | **Cost:** $0. No paid APIs. |
| NFR-7 | **Portability:** runs on macOS with Node ≥ 20 and `gh` authenticated. The static build works on GitHub Pages (Vite `base` set from config, all asset paths relative). |
| NFR-8 | **Theming:** light and dark mode, following the system setting, with a manual override. Cluster colours stay distinguishable in both themes. |
| NFR-9 | **Accessibility:** every action in the canvas is also reachable from a list view (search results, cluster overview, side panel), so the app is usable by keyboard alone. Text meets WCAG AA contrast. |
| NFR-10 | **Testability:** pipeline logic (README cleaning, signals, weight normalisation, top-k pruning, schema validation) is covered by Vitest unit tests on fixture data, with no network access. |

## 5. Data model

### 5.1 `public/graph.json`

```ts
type GraphFile = {
  version: 1;                     // bump on breaking schema changes; the app rejects unknown versions (FR-37)
  generatedAt: string;            // ISO
  user: string;                   // GitHub login
  clusters: Cluster[];
  nodes: RepoNode[];
  edges: RepoEdge[];
  duplicates?: [string, string, number][];  // [repoA, repoB, cosine] (FR-63, P1)
  concepts?: ConceptNode[];       // FR-73, P2
};

type Cluster = {
  id: number;                     // -1 = "Unclustered"; others ordered by size desc
  label: string;                  // TF-IDF or enrichment label
  color: string;
  size: number;
};

type RepoNode = {
  id: string;                     // "owner/repo"
  githubId: string;               // GitHub node id, stable across renames
  name: string;
  owner: string;
  url: string;
  homepage?: string;
  description?: string;
  readmeExcerpt?: string;
  language?: string;
  languages: string[];            // top 3
  topics: string[];
  tags?: string[];                // from manual.yaml (P2)
  stars: number;
  forks: number;
  license?: string;
  isArchived: boolean;
  isFork: boolean;
  pushedAt: string;
  createdAt: string;
  starredAt: string;
  cluster: number;
  x: number;
  y: number;
  metrics: {
    degree: number;
    weightedDegree: number;
    betweenness?: number;         // P1
    bridgeScore?: number;         // P1
  };
  enrichment?: Enrichment;        // P2
};

type RepoEdge = {
  source: string;
  target: string;
  weight: number;                 // 0..1
  signals: {
    semantic?: number;            // raw cosine
    topic?: number;               // Jaccard
    sharedTopics?: string[];
    mention?: boolean;
    dependency?: boolean;
    owner?: boolean;
    manual?: string;              // edge label, e.g. "alternative-of" (P2)
  };
};

type ConceptNode = {              // P2
  id: string;                     // "concept:<name>"
  label: string;
  repos: string[];                // repo ids linked to this concept
};
```

### 5.2 Intermediate files (git-ignored or committed, user's choice)

| Path | Content |
|---|---|
| `data/raw/stars.json` | Raw GraphQL results + sync metadata (`lastSyncAt`, per-repo `pushedAt`, `hasReadme`) |
| `data/raw/readmes/*.md` | README text |
| `data/raw/deps.json` | `{ [githubId]: string[] }` resolved starred dependencies (P1) |
| `data/embeddings.json` | `{ [githubId]: { hash, model, vector: number[] } }` |
| `data/enrichment.json` | Claude Code output (§5.3) |
| `data/enrich-todo.json` | Repos still to enrich (FR-70, P2) |
| `data/manual.yaml` | User tags and labelled edges (§5.4, P2) |
| `public/embeddings.bin` | Float32 vectors for in-browser semantic search (FR-53, P2) |

### 5.3 `data/enrichment.json`

```ts
type EnrichmentFile = Record<string, Enrichment>;  // key: "owner/repo"

type Enrichment = {
  summary: string;                // ≤ 2 sentences
  category: "library" | "framework" | "tool" | "app" | "awesome-list"
          | "learning" | "dataset" | "other";
  concepts: string[];             // 2–6 lowercase, normalised concepts
  alternativesTo?: string[];      // other starred repo ids (become manual edges, FR-29)
  enrichedAt: string;
};
```

Entries whose key is not a current star are reported and skipped. Ids in `alternativesTo` that are not starred are dropped.

### 5.4 `data/manual.yaml` (P2)

```yaml
tags:                             # repo id -> free-form tags (shown in panel, searchable)
  facebook/react: [ui, daily-driver]
edges:                            # labelled edges, always kept (FR-29)
  - from: preactjs/preact
    to: facebook/react
    label: alternative-of         # alternative-of | used-with | inspired-by | other
hide:                             # repo ids to exclude from the graph
  - someone/old-experiment
```

Validated with zod in `build-graph`; invalid entries are reported, not fatal.

## 6. UI layout

```
┌──────────────────────────────────────────────────────────────────┐
│ ⌕ Search…        [Language ▾] [Cluster ▾] [Archived ▾]  ◐ theme  │
├────────────┬───────────────────────────────────┬─────────────────┤
│ Views      │                                   │ Repo detail     │
│ • Graph    │                                   │ owner/repo      │
│ • Clusters │          sigma.js canvas          │ desc · lang · ★ │
│ • Bridges  │                                   │ topics          │
│ • Forgotten│                                   │ README excerpt  │
│ • Dupes    │                                   │ Similar (why)   │
│ • Path     │                                   │ [🎲 random walk] │
├────────────┴───────────────────────────────────┴─────────────────┤
│ Timeline  2019 ─────────────●────────── 2026   ▶                 │
└──────────────────────────────────────────────────────────────────┘
```

- On narrow screens, the left nav collapses into a menu and the detail panel becomes a bottom sheet.
- The header also shows data freshness ("Generated 3 days ago · 812 repos", FR-37).
- States: **loading** (spinner until `graph.json` is parsed), **empty/error** (missing or invalid `graph.json`, with the `pnpm data` hint), **no results** (search or filters match nothing, with a "clear filters" action).

## 7. Tech stack

| Layer | Choice |
|---|---|
| Package manager | pnpm |
| Language | TypeScript (strict) |
| Pipeline runtime | Node ≥ 20, `tsx` |
| GitHub access | `gh api graphql` via `execa` |
| Embeddings | `@huggingface/transformers` (`Xenova/all-MiniLM-L6-v2`) |
| Graph algorithms | `graphology`, `graphology-communities-louvain`, `graphology-metrics`, `graphology-layout-forceatlas2`, `graphology-shortest-path` |
| Frontend | Vite + React + TypeScript |
| Rendering | `sigma` + `@react-sigma/core` |
| UI | Tailwind CSS + shadcn/ui |
| Search | MiniSearch |
| Validation | zod |
| Tests | Vitest (pipeline logic: edge weights, top-k pruning, schema) |

### 7.1 Commands

| Command | Does |
|---|---|
| `pnpm data` | `sync` → `embed` → `build-graph` (FR-10) |
| `pnpm sync [--full]` | Fetch stars and READMEs into `data/raw/` |
| `pnpm embed` | Compute or refresh embeddings |
| `pnpm build-graph` | Write `public/graph.json` (and `embeddings.bin` when FR-53 is on) |
| `pnpm enrich:todo` | Write `data/enrich-todo.json` (FR-70) |
| `pnpm dev` | Vite dev server |
| `pnpm build` / `pnpm preview` | Static build / preview it |
| `pnpm test` | Vitest |

### 7.2 Config (`config/graph.config.ts`)

Single source for tunables: signal weights (FR-21), `semantic` rescale range, `k`, `minWeight`, Louvain `resolution` and seed, minimum cluster size, ForceAtlas2 iterations and seed, duplicate threshold (0.85), forgotten-star rules (FR-62), `includePrivate`, README concurrency, and Vite `base` for GitHub Pages.

## 8. Project structure

```
scripts/
  sync.ts
  embed.ts
  build-graph.ts
  enrich-todo.ts
  lib/            # github client, readme cleaner, edge signals, tfidf
config/
  graph.config.ts # weights, k, thresholds
data/
  raw/ embeddings.json enrichment.json manual.yaml
public/
  graph.json
src/
  app/ components/ features/{graph,detail,search,discovery,timeline}/ lib/
docs/
  project-brief.md prd.md enrichment.md
```

## 9. Release plan and acceptance criteria

### M1: First graph
- `pnpm data` syncs stars and READMEs, and builds a graph with topic, owner, and mention edges (no embeddings yet; weights renormalised per FR-21).
- The app renders all nodes with a precomputed layout; pan, zoom, and hover work.
- **Done when:** every starred public repo appears exactly once, and the count matches `gh api user/starred --paginate --jq '.[] | select(.private | not) | .full_name' | wc -l`; running `pnpm data` twice on the same input produces a byte-identical `graph.json` apart from `generatedAt` (NFR-4).

### M2: Meaningful clusters
- Embeddings, combined weights, top-k pruning, Louvain, and TF-IDF labels are in place.
- **Done when:** the success criteria in the brief (§8: cluster sense ≥ 80%) pass a manual check, and the number of non-forced edges is ≤ k × node count.

### M3: Daily explorer (MVP)
- Side panel, similar-with-reasons, search, filters, focus mode, cluster overview, dark mode.
- **Done when:** NFR-1 and NFR-2 are met, and the 20-repo relevance sample passes (≥ 3/5 relevant).

### M4: Discovery toolkit
- Bridges, path finder, forgotten stars, duplicates, timeline, random walk, URL state, dependency edges (FR-7).
- **Done when:** each view works on the real data set, a bookmarked URL restores the same filters, and the first session finds ≥ 10 forgotten or duplicate stars (brief §8).

### M5: Enrichment
- Claude Code workflow (FR-70–73), `manual.yaml` (FR-9, FR-29), and concept layer.
- **Done when:** `docs/enrichment.md` exists, a full enrichment pass validates with zero schema errors, and enrichment labels replace TF-IDF labels in the UI.

## 10. Out of scope

- Multi-user features, accounts, or a server.
- Editing GitHub stars or Lists from the app.
- Long-form note-taking or an Obsidian-style editor.
- Paid LLM or embedding APIs in the pipeline.
- Tracking repos that are not starred.
- Exporting to Obsidian or other note tools.

## 11. Open questions

| # | Question | Default if unanswered |
|---|---|---|
| Q1 | Commit `data/` and `public/graph.json` to git, or ignore them? | Commit `graph.json` and `enrichment.json`; ignore raw READMEs and embeddings |
| Q2 | Deploy to GitHub Pages? | Local only for M1–M3 |
| Q3 | Include forks that I starred? | Include; mark with `isFork` |
| Q4 | Tune k and weights through a UI? | Config file only |
| Q5 | Include private repos I starred? | Exclude (FR-11); revisit only if the site stays local-only |
| Q6 | Use GitHub star Lists (`viewer.lists`) as a filter or edge signal? | Not in MVP; candidate filter for M4 |
| Q7 | Non-English READMEs: `all-MiniLM-L6-v2` is English-only. Switch to a multilingual model? | Keep MiniLM; check cluster quality on non-English repos in M2 and switch to `paraphrase-multilingual-MiniLM-L12-v2` if they cluster badly |
| Q8 | Manual tags and labelled edges: hand-edited file or small UI? | Hand-edited `data/manual.yaml` (§5.4) |
