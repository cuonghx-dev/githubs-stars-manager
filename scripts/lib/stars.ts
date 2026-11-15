// Starred-repo fetch and `data/raw/stars.json` shaping (FR-1, FR-2, FR-11).
//
// Pure helpers plus one paging loop over an injected `GhClient`, so tests run
// against canned GraphQL pages and never touch the network (NFR-10).

import type { GhClient } from "./gh.ts";

/** Bump when the `stars.json` shape changes incompatibly. */
export const STARS_FILE_VERSION = 1;

/** GitHub caps `first` at 100 per page. */
export const STARS_PAGE_SIZE = 100;

export const STARS_QUERY = /* GraphQL */ `
  query StarredRepos($first: Int!, $after: String) {
    viewer {
      login
      starredRepositories(
        first: $first
        after: $after
        orderBy: { field: STARRED_AT, direction: DESC }
      ) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          starredAt
          node {
            id
            nameWithOwner
            description
            url
            homepageUrl
            primaryLanguage {
              name
            }
            languages(first: 3, orderBy: { field: SIZE, direction: DESC }) {
              nodes {
                name
              }
            }
            repositoryTopics(first: 20) {
              nodes {
                topic {
                  name
                }
              }
            }
            stargazerCount
            forkCount
            isArchived
            isFork
            isPrivate
            pushedAt
            createdAt
            licenseInfo {
              spdxId
            }
          }
        }
      }
    }
  }
`;

// ---- GraphQL response shape ----------------------------------------------

export interface GqlRepoNode {
  id: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
  homepageUrl: string | null;
  primaryLanguage: { name: string } | null;
  languages: { nodes: ({ name: string } | null)[] | null } | null;
  repositoryTopics: {
    nodes: ({ topic: { name: string } } | null)[] | null;
  } | null;
  stargazerCount: number;
  forkCount: number;
  isArchived: boolean;
  isFork: boolean;
  isPrivate: boolean;
  /** `null` for a repo that has never been pushed to. */
  pushedAt: string | null;
  createdAt: string;
  licenseInfo: { spdxId: string | null } | null;
}

export interface GqlStarEdge {
  starredAt: string;
  /** `null` when GitHub cannot resolve the repo (e.g. access lost). */
  node: GqlRepoNode | null;
}

export interface StarsPage {
  viewer: {
    login: string;
    starredRepositories: {
      totalCount: number;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: (GqlStarEdge | null)[] | null;
    };
  };
}

// ---- stars.json shape (implementation plan §3.4) -------------------------

/** README cache state; written by the README step (T1.3). */
export interface ReadmeState {
  status: "ok" | "missing";
  fetchedForPushedAt: string;
}

/**
 * One starred repo with the FR-2 fields. Connection fields are flattened:
 * `primaryLanguage` and `license` (SPDX id) are plain strings, `languages`
 * (top 3 by size) and `topics` are name lists.
 */
export interface RawRepo {
  /** GitHub node id; the stable cache key across renames (FR-4). */
  githubId: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
  homepageUrl: string | null;
  primaryLanguage: string | null;
  languages: string[];
  topics: string[];
  stargazerCount: number;
  forkCount: number;
  isArchived: boolean;
  isFork: boolean;
  isPrivate: boolean;
  pushedAt: string | null;
  createdAt: string;
  license: string | null;
  starredAt: string;
  /** Absent until the README step has run for this repo. */
  readme?: ReadmeState;
}

export interface StarsFile {
  version: typeof STARS_FILE_VERSION;
  user: string;
  lastSyncAt: string;
  /** Sorted by `nameWithOwner`. */
  repos: RawRepo[];
}

// ---- transforms ----------------------------------------------------------

/** Flatten one GraphQL edge into a `RawRepo`; `null` for unresolvable edges. */
export function toRawRepo(edge: GqlStarEdge): RawRepo | null {
  const node = edge.node;
  if (!node) return null;
  const blankToNull = (s: string | null) => (s && s.trim() ? s : null);
  return {
    githubId: node.id,
    nameWithOwner: node.nameWithOwner,
    description: blankToNull(node.description),
    url: node.url,
    homepageUrl: blankToNull(node.homepageUrl),
    primaryLanguage: node.primaryLanguage?.name ?? null,
    languages: (node.languages?.nodes ?? [])
      .flatMap((l) => (l ? [l.name] : []))
      .slice(0, 3),
    topics: (node.repositoryTopics?.nodes ?? []).flatMap((t) =>
      t ? [t.topic.name] : [],
    ),
    stargazerCount: node.stargazerCount,
    forkCount: node.forkCount,
    isArchived: node.isArchived,
    isFork: node.isFork,
    isPrivate: node.isPrivate,
    pushedAt: node.pushedAt,
    createdAt: node.createdAt,
    license: node.licenseInfo?.spdxId ?? null,
    starredAt: edge.starredAt,
  };
}

/** Drop private repos unless `includePrivate` is set (FR-11, PRD Q5). */
export function filterPrivate(
  repos: readonly RawRepo[],
  includePrivate: boolean,
): RawRepo[] {
  return includePrivate ? [...repos] : repos.filter((r) => !r.isPrivate);
}

const byName = (a: RawRepo, b: RawRepo) =>
  a.nameWithOwner < b.nameWithOwner
    ? -1
    : a.nameWithOwner > b.nameWithOwner
      ? 1
      : 0;

export interface BuildStarsFileInput {
  user: string;
  repos: readonly RawRepo[];
  /** ISO timestamp for `lastSyncAt`. */
  now: string;
  /** Previous `stars.json`; its README state is carried over by `githubId`. */
  previous?: StarsFile | null;
}

/**
 * Assemble `stars.json`: repos sorted by `nameWithOwner`, README state kept
 * from the previous file by `githubId` (so a rename keeps its cache, FR-4).
 */
export function buildStarsFile(input: BuildStarsFileInput): StarsFile {
  const previousReadme = new Map<string, ReadmeState>();
  for (const repo of input.previous?.repos ?? []) {
    if (repo.readme) previousReadme.set(repo.githubId, repo.readme);
  }
  const repos = input.repos
    .map((repo) => {
      const readme = repo.readme ?? previousReadme.get(repo.githubId);
      return readme ? { ...repo, readme } : { ...repo };
    })
    .sort(byName);
  return {
    version: STARS_FILE_VERSION,
    user: input.user,
    lastSyncAt: input.now,
    repos,
  };
}

export interface StarsDiff {
  added: RawRepo[];
  removed: RawRepo[];
  /** Repos whose `pushedAt` moved since the last sync. */
  changed: RawRepo[];
  /** Same `githubId`, new `nameWithOwner`. */
  renamed: { from: string; to: RawRepo }[];
}

/** Compare two repo lists by `githubId` for the sync summary. */
export function diffStars(
  previous: readonly RawRepo[],
  next: readonly RawRepo[],
): StarsDiff {
  const before = new Map(previous.map((r) => [r.githubId, r]));
  const after = new Set(next.map((r) => r.githubId));
  const diff: StarsDiff = { added: [], removed: [], changed: [], renamed: [] };
  for (const repo of next) {
    const old = before.get(repo.githubId);
    if (!old) {
      diff.added.push(repo);
      continue;
    }
    if (old.pushedAt !== repo.pushedAt) diff.changed.push(repo);
    if (old.nameWithOwner !== repo.nameWithOwner) {
      diff.renamed.push({ from: old.nameWithOwner, to: repo });
    }
  }
  for (const repo of previous) {
    if (!after.has(repo.githubId)) diff.removed.push(repo);
  }
  return diff;
}

// ---- fetch ---------------------------------------------------------------

export interface FetchStarsResult {
  user: string;
  totalCount: number;
  /** Unfiltered, in API order (newest star first), de-duplicated by id. */
  repos: RawRepo[];
  /** Edges whose node GitHub could not resolve. */
  skipped: number;
}

export interface FetchStarsOptions {
  pageSize?: number;
  /** Progress hook, called after each page. */
  onPage?: (fetched: number, totalCount: number) => void;
}

/** Page through `viewer.starredRepositories` until `hasNextPage` is false. */
export async function fetchStarredRepos(
  gh: Pick<GhClient, "graphql">,
  options: FetchStarsOptions = {},
): Promise<FetchStarsResult> {
  const first = options.pageSize ?? STARS_PAGE_SIZE;
  const seen = new Set<string>();
  const repos: RawRepo[] = [];
  let user: string;
  let totalCount: number;
  let skipped = 0;
  let after: string | null = null;

  for (;;) {
    const page: StarsPage = await gh.graphql<StarsPage>(STARS_QUERY, {
      first,
      after,
    });
    const conn = page.viewer.starredRepositories;
    user = page.viewer.login;
    totalCount = conn.totalCount;

    for (const edge of conn.edges ?? []) {
      const repo = edge ? toRawRepo(edge) : null;
      if (!repo) {
        skipped++;
        continue;
      }
      // A star added mid-run shifts pages; keep the first copy only.
      if (seen.has(repo.githubId)) continue;
      seen.add(repo.githubId);
      repos.push(repo);
    }
    options.onPage?.(repos.length, totalCount);

    if (!conn.pageInfo.hasNextPage) break;
    if (!conn.pageInfo.endCursor || conn.pageInfo.endCursor === after) {
      throw new Error(
        "starredRepositories: hasNextPage is true but the cursor did not advance",
      );
    }
    after = conn.pageInfo.endCursor;
  }

  return { user, totalCount, repos, skipped };
}
