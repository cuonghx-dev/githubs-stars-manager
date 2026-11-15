// Claude Code output `data/enrichment.json` (FR-8, FR-72, FR-29, PRD §5.3).
//
//   { "owner/repo": { summary, category, concepts, alternativesTo?, enrichedAt } }
//
// Every entry is validated on its own with zod; problems are reported, never
// fatal (FR-72):
// - an entry whose key is not a current star is reported and skipped;
// - an entry with a missing or invalid required field is reported and skipped;
// - unknown keys inside an entry are reported and dropped (the entry is kept);
// - `alternativesTo` ids that are malformed, not starred, or the repo itself
//   are reported and dropped (the entry is kept).
// Only an unparseable or non-object document drops the whole file.
//
// Repo ids are matched case-insensitively against the starred repos and
// rewritten to their canonical `owner/repo`. Concepts are trimmed, lowercased,
// whitespace-collapsed and de-duplicated. Entries and alternatives involving
// hidden repos (manual.yaml `hide`) are dropped quietly.
//
// `alternativesTo` becomes labelled `alternative-of` edges, which build-graph
// merges with the manual.yaml edges: forced, weight max(w, 0.5) (FR-29).
// Pure: the caller reads the file and logs the problems.

import { z } from "zod";
import {
  enrichmentCategorySchema,
  type Enrichment,
} from "../../src/lib/graph-schema.ts";
import type { ManualEdge } from "./manual.ts";

/** Known keys of an entry, in schema order (PRD §5.3). */
export const ENRICHMENT_KEYS = [
  "summary",
  "category",
  "concepts",
  "alternativesTo",
  "enrichedAt",
] as const;

/** PRD §5.3: 2–6 concepts per repo. */
export const MIN_CONCEPTS = 2;
export const MAX_CONCEPTS = 6;

const repoIdSchema = z
  .string()
  .trim()
  .regex(/^[^/\s]+\/[^/\s]+$/, "expected owner/repo");

const conceptSchema = z
  .string()
  .transform((s) => s.trim().toLowerCase().replace(/\s+/g, " "))
  .pipe(z.string().min(1, "empty concept"));

/** Required fields; `alternativesTo` is checked id by id afterwards. */
const entrySchema = z.object({
  summary: z.string().trim().min(1, "empty summary"),
  category: enrichmentCategorySchema,
  concepts: z
    .array(conceptSchema)
    .transform((list) => [...new Set(list)])
    .pipe(
      z
        .array(z.string())
        .min(MIN_CONCEPTS, `expected ${MIN_CONCEPTS}-${MAX_CONCEPTS} concepts`)
        .max(MAX_CONCEPTS, `expected ${MIN_CONCEPTS}-${MAX_CONCEPTS} concepts`),
    ),
  alternativesTo: z.array(z.unknown()).optional(),
  enrichedAt: z.iso.datetime({ offset: true }),
});

export interface EnrichmentData {
  /** Canonical repo id -> validated entry. */
  entries: Map<string, Enrichment>;
  /** `alternative-of` edges from `alternativesTo`, de-duplicated, in file order. */
  edges: ManualEdge[];
  /** Human-readable problems, one per dropped entry, key or id. */
  problems: string[];
}

export function emptyEnrichmentData(): EnrichmentData {
  return { entries: new Map(), edges: [], problems: [] };
}

function issueText(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message)
    .join("; ");
}

/**
 * Validate parsed `enrichment.json` content against the starred repo ids.
 * `knownIds` are canonical `owner/repo` ids of the visible starred repos
 * (before hiding); `hidden` are canonical ids excluded from the graph.
 */
export function parseEnrichment(
  doc: unknown,
  knownIds: Iterable<string>,
  hidden: ReadonlySet<string> = new Set(),
): EnrichmentData {
  const out = emptyEnrichmentData();
  const { problems } = out;

  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    problems.push('not a JSON object keyed by "owner/repo", file ignored');
    return out;
  }

  const canonical = new Map<string, string>();
  for (const id of knownIds) canonical.set(id.toLowerCase(), id);

  const seenEdges = new Set<string>();
  for (const [rawKey, rawEntry] of Object.entries(doc)) {
    const where = `["${rawKey}"]`;
    const key = repoIdSchema.safeParse(rawKey);
    if (!key.success) {
      problems.push(`${where}: ${issueText(key.error)}, entry skipped`);
      continue;
    }
    const id = canonical.get(key.data.toLowerCase());
    if (id === undefined) {
      problems.push(`${where}: not a starred repo, entry skipped`);
      continue;
    }
    if (hidden.has(id)) continue;
    if (out.entries.has(id)) {
      problems.push(`${where}: duplicate of "${id}", first one kept`);
      continue;
    }

    const parsed = entrySchema.safeParse(rawEntry);
    if (!parsed.success) {
      problems.push(`${where}: ${issueText(parsed.error)}, entry skipped`);
      continue;
    }
    for (const extra of Object.keys(rawEntry as object)) {
      if (!(ENRICHMENT_KEYS as readonly string[]).includes(extra)) {
        problems.push(`${where}: unknown key "${extra}" dropped`);
      }
    }

    const alternatives: string[] = [];
    (parsed.data.alternativesTo ?? []).forEach((raw, i) => {
      const at = `${where}.alternativesTo[${i}]`;
      const alt = repoIdSchema.safeParse(raw);
      if (!alt.success) {
        problems.push(
          `${at}: ${issueText(alt.error)} (got ${JSON.stringify(raw)}), dropped`,
        );
        return;
      }
      const altId = canonical.get(alt.data.toLowerCase());
      if (altId === undefined) {
        problems.push(`${at}: "${alt.data}" is not a starred repo, dropped`);
        return;
      }
      if (hidden.has(altId)) return;
      if (altId === id) {
        problems.push(`${at}: "${altId}" is the repo itself, dropped`);
        return;
      }
      if (alternatives.includes(altId)) return;
      alternatives.push(altId);
    });

    const entry: Enrichment = {
      summary: parsed.data.summary,
      category: parsed.data.category,
      concepts: parsed.data.concepts,
      ...(alternatives.length > 0 ? { alternativesTo: alternatives } : {}),
      enrichedAt: parsed.data.enrichedAt,
    };
    out.entries.set(id, entry);

    for (const altId of alternatives) {
      const pair = id < altId ? `${id}\n${altId}` : `${altId}\n${id}`;
      if (seenEdges.has(pair)) continue;
      seenEdges.add(pair);
      out.edges.push({ from: id, to: altId, label: "alternative-of" });
    }
  }

  return out;
}
