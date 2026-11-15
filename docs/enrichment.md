# Enrichment with Claude Code

Optional step (PRD §3.7, FR-70–FR-73). Claude Code reads the raw README of each
starred repo and writes a short structured entry to `data/enrichment.json`.
`build-graph` merges those entries into `public/graph.json`: the detail panel
shows the summary, category and concepts (FR-44), cluster labels come from
concepts once half of a cluster is enriched, `alternativesTo` becomes
`alternative-of` edges (FR-29), and concepts feed the concept layer (FR-73).

The graph builds fine without enrichment. You can enrich a few repos, all of
them, or none.

## Workflow

1. Make sure the pipeline data exists: `pnpm sync` (stars and READMEs) and
   `pnpm embed` have run at least once.
2. List the repos that still need an entry:

   ```bash
   pnpm enrich:todo
   ```

   This writes `data/enrich-todo.json` (git-ignored). It skips repos that
   already have a key in `enrichment.json` (case-insensitive) and repos hidden
   in `data/manual.yaml`.
3. Start Claude Code in the repo root and paste the prompt below.
4. When it stops, check the result:

   ```bash
   pnpm build-graph
   ```

   Look for `enrichmentProblems=0` on the `[build-graph]` summary line. Each
   invalid entry prints a `[build-graph] warning: enrichment.json ...` line.
5. Run `pnpm enrich:todo` again and repeat until `todo` is empty, then commit
   `data/enrichment.json` and `public/graph.json`.

## Files

| File | Role |
|---|---|
| `data/enrich-todo.json` | Input. `{ version, generatedAt, total, enriched, todo: [...] }`; each todo item has `id`, `description`, `url`, `primaryLanguage`, `topics`, `readme` (repo-relative path or `null`). Sorted by `id`. |
| `data/raw/readmes/<owner>__<repo>.md` | Raw README referenced by `readme`. |
| `data/enrichment.json` | Output. One JSON object keyed by `"owner/repo"`. Committed. |
| `scripts/lib/enrichment.ts` | The zod schema `build-graph` validates against. |

## Entry schema

```ts
type EnrichmentFile = Record<string, Enrichment>; // key: "owner/repo"

type Enrichment = {
  summary: string;        // 1–2 plain sentences, non-empty
  category:
    | "library" | "framework" | "tool" | "app"
    | "awesome-list" | "learning" | "dataset" | "other";
  concepts: string[];     // 2–6 distinct, lowercase concepts
  alternativesTo?: string[]; // other *starred* repo ids, "owner/repo"
  enrichedAt: string;     // ISO 8601 with offset, e.g. "2026-11-16T02:30:00Z"
};
```

Example:

```json
{
  "preactjs/preact": {
    "summary": "Fast 3 kB alternative to React with the same modern API. Supports hooks, components and a virtual DOM.",
    "category": "library",
    "concepts": ["virtual dom", "ui components", "hooks"],
    "alternativesTo": ["facebook/react"],
    "enrichedAt": "2026-11-16T02:30:00Z"
  }
}
```

How `build-graph` treats the file (never fatal, FR-72):

| Case | Result |
|---|---|
| File missing | No enrichment. |
| File is not valid JSON or not an object | Whole file ignored, one warning. |
| Key is not `owner/repo` or not a current star | Entry skipped. |
| Same repo twice (keys differ only by case) | First kept. |
| Missing or invalid required field | Entry skipped. |
| Fewer than 2 or more than 6 distinct concepts | Entry skipped. |
| Unknown key inside an entry | Key dropped, entry kept. |
| `alternativesTo` id not starred, malformed, or the repo itself | That id dropped, entry kept. |
| Repo hidden in `manual.yaml` | Skipped quietly. |

Concepts are trimmed, lowercased and whitespace-collapsed before the 2–6 check,
so `"State Management"` and `"state management"` count as one.

## Prompt

Paste this into Claude Code from the repo root. Change the batch size if you
want; 20 keeps each batch small enough to read every README in full.

````text
Enrich my starred repos for Stars Graph. Follow docs/enrichment.md exactly.

Input: data/enrich-todo.json. Its `todo` array lists repos with no entry in
data/enrichment.json yet. Each item has `id` ("owner/repo"), `description`,
`url`, `primaryLanguage`, `topics`, and `readme` (repo-relative path to the raw
README, or null).

Output: data/enrichment.json, one JSON object keyed by "owner/repo". If the file
does not exist, create it as {}.

Work in batches of 20 todo items, in file order:

1. Take the next 20 items whose `id` is not already a key in
   data/enrichment.json (compare case-insensitively).
2. For each item, read its README when `readme` is not null; otherwise use
   `description`, `topics` and `primaryLanguage`. Do not fetch anything from
   the network.
3. Write one entry per repo:
   - `summary`: 1–2 plain sentences saying what the repo is and what it is for.
     No marketing words, no emoji, no markdown.
   - `category`: exactly one of library, framework, tool, app, awesome-list,
     learning, dataset, other.
       library = code you import; framework = code that calls your code / sets
       app structure; tool = CLI, dev tool, extension, service you run;
       app = end-user application or website; awesome-list = curated link list;
       learning = tutorial, course, book, examples, interview prep;
       dataset = data, models, weights; other = none of these.
   - `concepts`: 2–6 distinct, lowercase, short noun phrases (1–3 words) naming
     the domain or technique, e.g. "vector database", "state management",
     "web scraping". Prefer reusable concepts that other repos may share over
     product names. No language names unless the language is the subject.
   - `alternativesTo`: optional. Only ids of other repos that I have starred
     (they appear in data/enrich-todo.json `todo` or as keys in
     data/enrichment.json) and that solve the same problem. Omit the field when
     unsure. Never list the repo itself.
   - `enrichedAt`: the current time in ISO 8601 UTC, e.g. "2026-11-16T02:30:00Z".
   Use only these five keys. Use the todo item's `id` exactly as the key.
4. Append the batch to data/enrichment.json: read the file, add the new keys,
   keep every existing entry unchanged, and write it back as valid JSON with
   2-space indentation. Never delete or rewrite existing entries. Never write a
   partial batch that breaks the JSON.
5. Run `pnpm build-graph` and read its output. Fix every
   `warning: enrichment.json ...` line caused by entries you wrote, then run it
   again until the `[build-graph]` summary line shows `enrichmentProblems=0`.
6. Report the batch: ids added, and any repo you skipped and why.

Continue with the next batch until every todo item has an entry, then run
`pnpm enrich:todo` and confirm `todo` is empty. Do not commit.
````

## Notes

- Re-running is safe: `enrich:todo` only lists repos without a key, and the
  prompt never overwrites existing entries. To redo a repo, delete its key from
  `enrichment.json` and run `pnpm enrich:todo` again.
- New stars after `pnpm sync` show up in the next `pnpm enrich:todo`.
- Entries for repos you unstar stay in the file and are reported as
  `not a starred repo, entry skipped`; delete them when convenient.
- `pnpm build-graph` also rewrites `public/graph.json`. Without
  `data/embeddings.json` it still runs (semantic signal off, one warning), so
  the enrichment check works either way; run `pnpm embed` before the final
  build you commit.
