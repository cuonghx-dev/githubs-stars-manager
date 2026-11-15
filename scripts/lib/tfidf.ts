// Cluster labels from TF-IDF (FR-25).
//
// One document per real cluster: every member's topics plus the words of its
// description. Stop words and generic terms ("library", "awesome", "github",
// ...) are dropped. Each term is scored by
//
//   tf(t, c) × idf(t),  tf = count / doc length,  idf = ln((1 + N) / (1 + df)) + 1
//
// where N is the number of real clusters and df the number of clusters whose
// document contains t. The label is the top 3 terms joined with " · ". The
// Unclustered group (-1) is always labelled "Unclustered" and is not a
// document, so it does not skew idf.
//
// Topics are curated tags, so they stay whole ("machine-learning") and count
// `TOPIC_WEIGHT` times; description words are lowercase unigrams. A term whose
// words are already covered by a chosen term (e.g. "learning" after
// "machine-learning") is skipped, so labels do not repeat themselves.
//
// Enrichment (T5.4): when at least half of a cluster's members carry
// enrichment `concepts`, the label is built from concepts instead. Each
// cluster's concept document holds every enriched member's concepts (count 1
// per member); concepts are scored with the same tf × idf, where idf runs over
// the concept documents of all real clusters. A cluster whose concepts yield no
// usable term keeps its TF-IDF label.
//
// Deterministic: ties break by term asc, so same input → same labels.

import { UNCLUSTERED_ID, UNCLUSTERED_LABEL } from "./clusters.ts";

/** Terms per label (FR-25). */
export const LABEL_TERMS = 3;
/** Separator between label terms. */
export const LABEL_SEPARATOR = " · ";
/** Topics are curated tags; weigh them above free-text description words. */
export const TOPIC_WEIGHT = 2;
/** Description tokens shorter than this are noise (2 keeps "js", "ui"). */
const MIN_TOKEN_LENGTH = 2;

/** Common English function words. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "etc",
  "even",
  "every",
  "few",
  "for",
  "from",
  "further",
  "get",
  "gets",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "just",
  "let",
  "lets",
  "like",
  "made",
  "make",
  "makes",
  "many",
  "may",
  "me",
  "more",
  "most",
  "much",
  "must",
  "my",
  "need",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "one",
  "only",
  "or",
  "other",
  "our",
  "ours",
  "out",
  "over",
  "own",
  "per",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "upon",
  "us",
  "use",
  "used",
  "uses",
  "using",
  "very",
  "via",
  "was",
  "we",
  "well",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "within",
  "without",
  "would",
  "you",
  "your",
  "yours",
]);

/**
 * Words that appear across all kinds of repos and say nothing about a
 * cluster (FR-25: "library", "awesome", "github", ...).
 */
export const GENERIC_TERMS: ReadonlySet<string> = new Set([
  "awesome",
  "based",
  "best",
  "better",
  "build",
  "built",
  "code",
  "collection",
  "curated",
  "easy",
  "easily",
  "example",
  "examples",
  "fast",
  "faster",
  "feature",
  "features",
  "free",
  "full",
  "github",
  "help",
  "helps",
  "implementation",
  "library",
  "libraries",
  "lightweight",
  "list",
  "lists",
  "modern",
  "new",
  "official",
  "open",
  "opensource",
  "open-source",
  "package",
  "packages",
  "powerful",
  "project",
  "projects",
  "repo",
  "repository",
  "resources",
  "simple",
  "small",
  "source",
  "support",
  "supports",
  "tool",
  "tools",
  "toolkit",
  "useful",
  "way",
  "written",
]);

export interface LabelSource {
  topics: readonly string[];
  description?: string | null;
  /** Normalised enrichment concepts (data/enrichment.json), when enriched. */
  concepts?: readonly string[];
}

export interface LabelCluster {
  id: number;
  /** Member node ids. */
  members: readonly string[];
}

const byTerm = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function isNoise(term: string): boolean {
  return STOP_WORDS.has(term) || GENERIC_TERMS.has(term) || /^\d+$/.test(term);
}

/** Lowercase description words, stop words and generic terms removed. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  // Letters and digits in any script; inner "+", "#", "." keep c++, c#, node.js.
  for (const match of text
    .toLowerCase()
    .matchAll(/[\p{L}\p{N}][\p{L}\p{N}+#.]*/gu)) {
    const token = match[0].replace(/\.+$/, "");
    if (token.length < MIN_TOKEN_LENGTH || isNoise(token)) continue;
    out.push(token);
  }
  return out;
}

/** Term counts of one cluster document (topics weighted, description words). */
function clusterDocument(
  members: readonly string[],
  sources: ReadonlyMap<string, LabelSource>,
): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (term: string, n: number) =>
    counts.set(term, (counts.get(term) ?? 0) + n);
  for (const id of members) {
    const source = sources.get(id);
    if (!source) continue;
    for (const topic of source.topics) {
      const term = topic.trim().toLowerCase();
      if (term.length === 0 || isNoise(term)) continue;
      add(term, TOPIC_WEIGHT);
    }
    for (const word of tokenize(source.description ?? "")) add(word, 1);
  }
  return counts;
}

/** Concept counts of one cluster document; also the enriched member count. */
function conceptDocument(
  members: readonly string[],
  sources: ReadonlyMap<string, LabelSource>,
): { counts: Map<string, number>; enriched: number } {
  const counts = new Map<string, number>();
  let enriched = 0;
  for (const id of members) {
    const concepts = sources.get(id)?.concepts;
    if (!concepts || concepts.length === 0) continue;
    enriched += 1;
    for (const concept of new Set(
      concepts.map((c) => c.trim().toLowerCase()),
    )) {
      if (concept.length === 0 || isNoise(concept)) continue;
      counts.set(concept, (counts.get(concept) ?? 0) + 1);
    }
  }
  return { counts, enriched };
}

/** Document frequency of every term over `docs`. */
function documentFrequency(
  docs: readonly Map<string, number>[],
): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of doc.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }
  return df;
}

/** Top `LABEL_TERMS` terms of `doc` by tf × idf; empty when nothing usable. */
function topTerms(
  doc: ReadonlyMap<string, number>,
  df: ReadonlyMap<string, number>,
  n: number,
): string[] {
  let length = 0;
  for (const count of doc.values()) length += count;
  if (length === 0) return [];
  const scored = [...doc].map(([term, count]) => {
    const idf = Math.log((1 + n) / (1 + df.get(term)!)) + 1;
    return { term, score: (count / length) * idf };
  });
  scored.sort((a, b) => b.score - a.score || byTerm(a.term, b.term));
  return pickTerms(
    scored.map((s) => s.term),
    LABEL_TERMS,
  );
}

/**
 * Words of a term for the coverage check: split on "-", "_" and spaces, with a
 * trailing plural "s" folded so "agent" counts as covered by "ai-agents".
 */
function wordsOf(term: string): string[] {
  return term
    .split(/[-_\s]+/)
    .filter((w) => w.length > 0)
    .map((w) =>
      w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w,
    );
}

/** Top terms, skipping any whose words are all covered by an earlier pick. */
function pickTerms(ranked: readonly string[], n: number): string[] {
  const picked: string[] = [];
  const covered = new Set<string>();
  for (const term of ranked) {
    if (picked.length >= n) break;
    const words = wordsOf(term);
    // A term must add at least one new word to the label.
    if (words.every((w) => covered.has(w))) continue;
    picked.push(term);
    for (const w of words) covered.add(w);
  }
  return picked;
}

/**
 * Label for every cluster id. Clusters with ≥ half their members enriched are
 * labelled from concepts, others from topics + descriptions. Real clusters with
 * no usable terms fall back to `Cluster <id + 1>`; -1 is always "Unclustered".
 */
export function clusterLabels(
  clusters: readonly LabelCluster[],
  sources: ReadonlyMap<string, LabelSource>,
): Map<number, string> {
  const real = clusters.filter((c) => c.id !== UNCLUSTERED_ID);
  const n = real.length;
  const docs = real.map((c) => clusterDocument(c.members, sources));
  const df = documentFrequency(docs);
  const conceptDocs = real.map((c) => conceptDocument(c.members, sources));
  const conceptDf = documentFrequency(conceptDocs.map((d) => d.counts));

  const labels = new Map<number, string>();
  real.forEach((cluster, i) => {
    const concept = conceptDocs[i]!;
    // Enrichment overrides once at least half the members are enriched.
    let terms =
      concept.enriched > 0 && concept.enriched * 2 >= cluster.members.length
        ? topTerms(concept.counts, conceptDf, n)
        : [];
    if (terms.length === 0) terms = topTerms(docs[i]!, df, n);
    labels.set(
      cluster.id,
      terms.length > 0
        ? terms.join(LABEL_SEPARATOR)
        : `Cluster ${cluster.id + 1}`,
    );
  });
  if (clusters.some((c) => c.id === UNCLUSTERED_ID)) {
    labels.set(UNCLUSTERED_ID, UNCLUSTERED_LABEL);
  }
  return labels;
}
