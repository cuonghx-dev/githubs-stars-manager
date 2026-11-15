import MiniSearch from "minisearch";
import type { RepoNode } from "@/lib/graph-schema";

// Fuzzy repo search (FR-50, T3.6): MiniSearch over name, owner, description
// and topics with prefix matching and fuzzy 0.2; the repo name is boosted so
// exact-ish name hits rank above description mentions.

export interface SearchHit {
  id: string;
  name: string;
  owner: string;
  description?: string;
  score: number;
}

interface SearchDoc {
  id: string;
  name: string;
  owner: string;
  description: string;
  topics: string;
}

export type RepoSearchIndex = MiniSearch<SearchDoc>;

export const SEARCH_LIMIT = 8;

export function buildSearchIndex(nodes: readonly RepoNode[]): RepoSearchIndex {
  const index = new MiniSearch<SearchDoc>({
    fields: ["name", "owner", "description", "topics"],
    storeFields: [],
    // Split on non-alphanumerics so "react-sigma" also matches "sigma".
    tokenize: (text) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean),
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
      boost: { name: 3, owner: 1.5 },
      combineWith: "AND",
    },
  });
  index.addAll(
    nodes.map((n) => ({
      id: n.id,
      name: n.name,
      owner: n.owner,
      description: n.description ?? "",
      topics: n.topics.join(" "),
    })),
  );
  return index;
}

export function searchRepos(
  index: RepoSearchIndex,
  repoById: ReadonlyMap<string, RepoNode>,
  query: string,
  limit = SEARCH_LIMIT,
): SearchHit[] {
  const q = query.trim();
  if (q === "") return [];
  const hits: SearchHit[] = [];
  for (const result of index.search(q)) {
    const repo = repoById.get(String(result.id));
    if (!repo) continue;
    hits.push({
      id: repo.id,
      name: repo.name,
      owner: repo.owner,
      description: repo.description,
      score: result.score,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}
