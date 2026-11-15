// Hand-edited `data/manual.yaml` (FR-9, FR-29, PRD §5.4).
//
//   tags:   repo id -> free-form tags (shown in the panel, searchable)
//   edges:  labelled edges, always kept, weight max(w, 0.5)
//   hide:   repo ids excluded from the graph
//
// Every entry is validated on its own with zod: a bad entry (wrong shape,
// unknown label, repo that is not starred, self-edge, duplicate) is reported
// and dropped, never fatal. Only an unparseable YAML document drops the whole
// file, and that is reported too. Repo ids are matched case-insensitively
// against the starred repos and rewritten to their canonical `owner/repo`.
// Pure: the caller reads the file and logs the problems.

import { parse as parseYaml } from "yaml";
import { z } from "zod";

/** Allowed labels for manual edges (PRD §5.4). */
export const MANUAL_EDGE_LABELS = [
  "alternative-of",
  "used-with",
  "inspired-by",
  "other",
] as const;
export type ManualEdgeLabel = (typeof MANUAL_EDGE_LABELS)[number];

/** Floor applied to the combined weight of a manual edge (FR-29). */
export const MANUAL_MIN_WEIGHT = 0.5;

const repoIdSchema = z
  .string()
  .trim()
  .regex(/^[^/\s]+\/[^/\s]+$/, "expected owner/repo");

const tagSchema = z.string().trim().min(1, "empty tag");

const edgeSchema = z.object({
  from: repoIdSchema,
  to: repoIdSchema,
  label: z.enum(MANUAL_EDGE_LABELS),
});

const sectionSchema = z
  .object({
    tags: z.record(z.string(), z.unknown()).nullish(),
    edges: z.array(z.unknown()).nullish(),
    hide: z.array(z.unknown()).nullish(),
  })
  .loose();

export interface ManualEdge {
  /** Canonical `owner/repo`. */
  from: string;
  to: string;
  label: ManualEdgeLabel;
}

export interface ManualData {
  /** Canonical repo id -> sorted, de-duplicated tags. */
  tags: Map<string, string[]>;
  /** Valid edges between visible starred repos, in file order. */
  edges: ManualEdge[];
  /** Canonical ids of hidden repos. */
  hide: Set<string>;
  /** Human-readable problems, one per dropped entry. */
  problems: string[];
}

export function emptyManualData(): ManualData {
  return { tags: new Map(), edges: [], hide: new Set(), problems: [] };
}

function issueText(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message)
    .join("; ");
}

/**
 * Parse and validate `manual.yaml` text against the starred repo ids.
 * `knownIds` are canonical `owner/repo` ids (the repos in the graph before
 * hiding).
 */
export function parseManual(
  text: string,
  knownIds: Iterable<string>,
): ManualData {
  const out = emptyManualData();
  const { problems } = out;

  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (error) {
    problems.push(
      `invalid YAML, file ignored: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
    );
    return out;
  }
  if (doc === null || doc === undefined) return out;

  const top = sectionSchema.safeParse(doc);
  if (!top.success) {
    problems.push(
      `invalid top-level shape, file ignored: ${issueText(top.error)}`,
    );
    return out;
  }
  for (const key of Object.keys(top.data)) {
    if (key !== "tags" && key !== "edges" && key !== "hide") {
      problems.push(`unknown top-level key "${key}" ignored`);
    }
  }

  const canonical = new Map<string, string>();
  for (const id of knownIds) canonical.set(id.toLowerCase(), id);
  const resolve = (where: string, raw: unknown): string | undefined => {
    const parsed = repoIdSchema.safeParse(raw);
    if (!parsed.success) {
      problems.push(
        `${where}: ${issueText(parsed.error)} (got ${JSON.stringify(raw)})`,
      );
      return undefined;
    }
    const id = canonical.get(parsed.data.toLowerCase());
    if (id === undefined) {
      problems.push(`${where}: "${parsed.data}" is not a starred repo`);
    }
    return id;
  };

  // hide first, so tags and edges on hidden repos are dropped quietly.
  (top.data.hide ?? []).forEach((raw, i) => {
    const id = resolve(`hide[${i}]`, raw);
    if (id === undefined) return;
    if (out.hide.has(id)) problems.push(`hide[${i}]: "${id}" listed twice`);
    out.hide.add(id);
  });

  for (const [rawId, rawTags] of Object.entries(top.data.tags ?? {})) {
    const where = `tags["${rawId}"]`;
    const id = resolve(where, rawId);
    if (id === undefined || out.hide.has(id)) continue;
    const list = Array.isArray(rawTags) ? rawTags : [rawTags];
    const tags = new Set(out.tags.get(id) ?? []);
    list.forEach((rawTag, j) => {
      const tag = tagSchema.safeParse(rawTag);
      if (!tag.success) {
        problems.push(
          `${where}[${j}]: ${issueText(tag.error)} (got ${JSON.stringify(rawTag)})`,
        );
        return;
      }
      tags.add(tag.data);
    });
    if (tags.size > 0) out.tags.set(id, [...tags].sort());
  }

  const seen = new Set<string>();
  (top.data.edges ?? []).forEach((raw, i) => {
    const where = `edges[${i}]`;
    const edge = edgeSchema.safeParse(raw);
    if (!edge.success) {
      problems.push(`${where}: ${issueText(edge.error)}`);
      return;
    }
    const from = resolve(`${where}.from`, edge.data.from);
    const to = resolve(`${where}.to`, edge.data.to);
    if (from === undefined || to === undefined) return;
    if (out.hide.has(from) || out.hide.has(to)) return;
    if (from === to) {
      problems.push(`${where}: self-edge on "${from}"`);
      return;
    }
    const key = from < to ? `${from}\n${to}` : `${to}\n${from}`;
    if (seen.has(key)) {
      problems.push(`${where}: duplicate edge ${from} – ${to}, first one kept`);
      return;
    }
    seen.add(key);
    out.edges.push({ from, to, label: edge.data.label });
  });

  return out;
}
