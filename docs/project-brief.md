# Project Brief: Stars Graph

| | |
|---|---|
| Status | Draft |
| Owner | cuonghx |
| Last updated | 2026-11-15 |
| Related | [PRD](./prd.md) · [Implementation Plan](./implementation-plan.md) |

## 1. Summary

Stars Graph is a personal, local-first website that turns my GitHub stars (fewer than 1,000 repos) into an explorable knowledge graph. Each starred repository is a node. Edges come from signals computed offline: README similarity, shared topics, cross-references between READMEs, and shared dependencies. The main purpose is **discovery**: finding clusters, links between areas, forgotten stars, and repos that overlap in function, instead of scrolling a flat list.

## 2. Problem

- GitHub's stars page is a flat, reverse-chronological list. The only organisation tool is manual Lists.
- Once you have hundreds of stars, you forget why you starred something and which repos solve the same problem.
- Nothing shows how starred repos relate to each other, such as "this is an alternative to that" or "these 12 repos are all about local-first sync".
- Search on GitHub stars works on keywords only. A query like "graph rendering library for the browser" misses repos that describe themselves in different words.

## 3. Goals

1. **See the shape of my interests.** Open the site and see clusters of related repos with readable labels.
2. **Explore by relationship.** From any repo, jump to similar or related repos and see *why* they are linked.
3. **Resurface forgotten stars.** Show isolated, old, or archived repos so I can revisit or unstar them.
4. **Zero running cost, zero backend.** Everything runs locally or as a static site, with no paid APIs.

## 4. Non-goals

- Multi-user support, OAuth, or hosting for other people.
- A writing-first knowledge base with long-form notes. Exploration comes first; manual notes are optional and come later.
- Paid LLM or embedding APIs. Enrichment, if used, is a manual step run with my existing Claude Code.
- Real-time sync. Data refreshes when I run a script.
- Managing stars (star/unstar) from the UI.

## 5. Target user

One user: me. A developer with fewer than 1,000 stars, comfortable running CLI scripts, already authenticated with `gh` and using Claude Code.

## 6. Solution overview

```
gh api graphql ──► scripts/sync.ts ──► data/raw/ (stars, READMEs)
                                          │
                     scripts/embed.ts ◄───┤  local model, cached
                                          │
              scripts/build-graph.ts ◄────┘  edges, clusters, metrics, layout
                         │
                         ▼
                 public/graph.json ──► Vite + React + sigma.js (static site)
                         ▲
   data/enrichment.json ─┘  (optional, written by Claude Code)
```

- **Offline pipeline** computes everything heavy: embeddings, edges, Louvain clusters, betweenness, and the ForceAtlas2 layout.
- **Frontend** is static. It only loads `graph.json` and renders it with WebGL.
- **Enrichment** is optional and manual. Claude Code reads raw READMEs and writes categories, concepts, and summaries to a JSON file that the build step merges in.

## 7. Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Hosting | Local dev server; optional GitHub Pages | Single user, stars are already public |
| Storage | JSON files in repo | Under 1k nodes fits in a few MB; no DB needed |
| GitHub access | `gh` CLI (`gh api graphql`) | Reuses existing auth, no token handling |
| Similarity | Local embeddings (`all-MiniLM-L6-v2` via transformers.js) | Free, offline, good enough for README text |
| Graph lib | `graphology` + `sigma.js` | Fast WebGL rendering, strong algorithm ecosystem |
| Layout | Precomputed ForceAtlas2 at build time | Instant, stable first paint |
| Edge density | Top-k neighbours per node (k ≈ 5–8) | Prevents an unreadable "hairball" |
| LLM | None in the pipeline; Claude Code as manual enrichment | No API cost, no data sent from scripts |

## 8. Success criteria

- Full pipeline (sync, embed, build) runs with one command in under 5 minutes for about 1,000 repos on first run, and under 1 minute on incremental runs.
- Graph page becomes interactive in under 2 seconds on a laptop.
- At least 80% of repos belong to a cluster whose label I find sensible when I check by hand.
- For a random sample of 20 repos, at least 3 of the top-5 "similar" repos are judged relevant.
- I find at least 10 forgotten or duplicate stars in the first session.

## 9. Milestones

| Phase | Scope | Outcome |
|---|---|---|
| M1 | Sync + basic graph (topic, owner, mention edges) | First visible graph |
| M2 | Embeddings, combined edge weights, top-k, Louvain clusters | Meaningful clusters |
| M3 | Side panel, search, focus mode, "similar with reasons" | Usable daily explorer |
| M4 | Bridges, path finder, timeline, random walk, forgotten stars | Full discovery toolkit |
| M5 | Claude Code enrichment workflow | Richer labels and concepts |

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Graph becomes an unreadable hairball | Top-k pruning, minimum weight threshold, focus mode |
| Short or missing READMEs give weak embeddings | Fall back to description + topics; weight other signals higher |
| GitHub API rate limits during README fetch | GraphQL batching, cache by `pushedAt`/hash, incremental sync |
| Cluster labels are meaningless | TF-IDF labels first; optional Claude Code labels in M5 |
| Local model download and first-run speed | Cache model and embeddings; only re-embed changed READMEs |
| Private starred repos leak if the site is published | Exclude private repos by default (PRD FR-11) |
| Non-English READMEs embed poorly with an English-only model | Check in M2; switch to a multilingual MiniLM if needed (PRD Q7) |
| Non-deterministic clusters or layout make the graph "jump" between runs | Seeded Louvain and layout, stable cluster ids and colours (PRD FR-24, FR-27) |

## 11. Open questions

Tracked with default answers in [PRD §11](./prd.md#11-open-questions). Still open here:

- Deploy to GitHub Pages, or keep it local only? (PRD Q2; default: local only for M1–M3)

Resolved:

- Manual tags and labelled edges live in a hand-edited `data/manual.yaml`; no UI (PRD Q8, §5.4).
- Obsidian vault export is out of scope (PRD §10).
