# Stars Graph

Explore your GitHub stars as an interactive similarity graph. Each starred repo
is a node. Edges come from signals computed offline: README similarity (local
embeddings), shared topics, cross-references between READMEs, shared
dependencies and shared owners. The app is a static site; there is no backend
and no paid API.

Use it to see clusters of related repos, find repos that link two areas,
resurface stars you forgot about, and spot repos that overlap in function.

## Features

- **Graph**: WebGL rendering with sigma.js, a precomputed ForceAtlas2 layout and
  Louvain clusters with stable colours and labels.
- **Detail panel**: stars, language, dates, license, topics, README excerpt,
  similar repos with the reasons they are linked, and a **View on GitHub** link.
- **Search and filters**: fuzzy search plus filters by language, cluster,
  archived state and starred date.
- **Focus mode**: select a repo to highlight its 1-hop and 2-hop neighbours.
- **Views**: Clusters overview, Bridges (repos that link clusters), Forgotten
  stars, Dupes (overlapping pairs) and Path (shortest route between two repos).
- **Timeline and random walk**: replay stars by starred date, or wander the
  graph one weighted step at a time.
- **Shareable state**: filters, selection and view are kept in the URL.
- **Languages**: English and Vietnamese UI. The header toggle switches them;
  the first visit follows the browser language and the choice is remembered.
- **Optional enrichment**: summaries, categories and concepts written by Claude
  Code, plus a toggleable concept layer.

## How it works

```
gh api graphql ──► scripts/sync.ts ──► data/raw/ (stars, READMEs, deps)
                                          │
                     scripts/embed.ts ◄───┤  all-MiniLM-L6-v2, cached
                                          │
              scripts/build-graph.ts ◄────┘  edges, clusters, metrics, layout
                         │
                         ▼
                 public/graph.json ──► Vite + React + sigma.js
                         ▲
   data/enrichment.json ─┤  optional, written by Claude Code
   data/manual.yaml ─────┘  optional, hand-edited
```

The pipeline does the heavy work once. The frontend only loads
`public/graph.json`.

## Requirements

- Node.js 24 (see `.nvmrc`; `>=20` is the minimum)
- pnpm 9
- [GitHub CLI](https://cli.github.com/) logged in (`gh auth login`). The sync
  step reuses its auth, so there is no token to manage.

## Quick start

```bash
pnpm install
pnpm data   # sync stars + READMEs, embed, build public/graph.json
pnpm dev    # http://localhost:5173
```

A generated `public/graph.json` is committed, so `pnpm dev` works without
running the pipeline. Run `pnpm data` to build the graph from your own stars.

The first `pnpm embed` downloads the embedding model. Later runs only re-embed
READMEs that changed.

## Scripts

| Command                                        | What it does                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm data`                                    | Run `sync`, `embed` and `build-graph` in order                                                |
| `pnpm sync [--full]`                           | Fetch starred repos, READMEs and root manifests into `data/raw/`. `--full` ignores the caches |
| `pnpm embed [--full]`                          | Embed READMEs into `data/embeddings.json`. `--full` ignores the cache                         |
| `pnpm build-graph`                             | Build `public/graph.json`: edges, clusters, metrics and layout                                |
| `pnpm enrich:todo`                             | List repos that still need an enrichment entry                                                |
| `pnpm dev`                                     | Start the Vite dev server                                                                     |
| `pnpm build` / `pnpm preview`                  | Type-check, build the static site to `dist/`, preview it                                      |
| `pnpm test`                                    | Run the Vitest suite                                                                          |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | Type-check, lint, format                                                                      |

## Keyboard shortcuts

| Key       | Action                                   |
| --------- | ---------------------------------------- |
| `/`       | Focus search                             |
| `Esc`     | Clear selection, or go back to the graph |
| `f`       | Fit graph to screen                      |
| `r`       | Random walk step                         |
| `[` / `]` | Walk back / forward                      |
| `?`       | Show all shortcuts                       |

## Configuration

All tunables live in `config/graph.config.ts`: signal weights, top-k
neighbours, minimum edge weight, Louvain resolution and seed, layout
iterations, duplicate threshold, forgotten-star rules, the embedding model and
whether private repos are included (they are excluded by default).

### Manual data

Create `data/manual.yaml` to add your own tags, labelled edges, or hide repos:

```yaml
tags:
  owner/repo: [favourite, to-try]
edges:
  - from: owner/a
    to: owner/b
    label: alternative-of # alternative-of | used-with | inspired-by | other
hide:
  - owner/noise
```

Invalid entries are reported and skipped; they never fail the build.

### Enrichment

Optional. Claude Code reads each raw README and writes a summary, category,
concepts and alternatives to `data/enrichment.json`, which `build-graph` merges
in. See [docs/enrichment.md](docs/enrichment.md) for the prompt and workflow.

## Project layout

```
config/    pipeline and build tunables
scripts/   offline pipeline (sync, embed, build-graph, enrich-todo)
src/       React app (app/, features/, components/, hooks/, lib/)
public/    graph.json served to the app
data/      raw caches (git-ignored), manual.yaml, enrichment.json
docs/      project brief, PRD, implementation plan, enrichment guide
```

## Docs

- [Project brief](docs/project-brief.md)
- [PRD](docs/prd.md)
- [Implementation plan](docs/implementation-plan.md)
- [Enrichment workflow](docs/enrichment.md)
