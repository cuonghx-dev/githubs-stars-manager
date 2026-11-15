import { describe, expect, it, vi } from "vitest";
import {
  STARS_PAGE_SIZE,
  STARS_QUERY,
  buildStarsFile,
  diffStars,
  fetchStarredRepos,
  filterPrivate,
  toRawRepo,
  type GqlRepoNode,
  type GqlStarEdge,
  type RawRepo,
  type StarsPage,
} from "./stars.ts";

function node(overrides: Partial<GqlRepoNode> = {}): GqlRepoNode {
  return {
    id: "R_1",
    nameWithOwner: "acme/widget",
    description: "A widget",
    url: "https://github.com/acme/widget",
    homepageUrl: "https://widget.dev",
    primaryLanguage: { name: "TypeScript" },
    languages: {
      nodes: [{ name: "TypeScript" }, { name: "JavaScript" }, { name: "CSS" }],
    },
    repositoryTopics: {
      nodes: [{ topic: { name: "ui" } }, { topic: { name: "react" } }],
    },
    stargazerCount: 120,
    forkCount: 7,
    isArchived: false,
    isFork: false,
    isPrivate: false,
    pushedAt: "2026-10-01T00:00:00Z",
    createdAt: "2020-01-01T00:00:00Z",
    licenseInfo: { spdxId: "MIT" },
    ...overrides,
  };
}

function edge(
  overrides: Partial<GqlRepoNode> = {},
  starredAt = "2026-11-01T00:00:00Z",
): GqlStarEdge {
  return { starredAt, node: node(overrides) };
}

function repo(overrides: Partial<RawRepo> = {}): RawRepo {
  const r = toRawRepo(edge());
  if (!r) throw new Error("fixture");
  return { ...r, ...overrides };
}

function page(
  edges: (GqlStarEdge | null)[] | null,
  endCursor: string | null,
  hasNextPage: boolean,
  totalCount = 0,
): StarsPage {
  return {
    viewer: {
      login: "octo",
      starredRepositories: {
        totalCount,
        pageInfo: { hasNextPage, endCursor },
        edges,
      },
    },
  };
}

describe("STARS_QUERY", () => {
  it("asks for the plan's ordering and connection sizes", () => {
    const q = STARS_QUERY.replace(/\s+/g, " ");
    expect(q).toContain("orderBy: { field: STARRED_AT, direction: DESC }");
    expect(q).toContain(
      "languages(first: 3, orderBy: { field: SIZE, direction: DESC })",
    );
    expect(q).toContain("repositoryTopics(first: 20)");
    expect(q).toContain("licenseInfo { spdxId }");
    expect(q).toContain("starredAt");
  });
});

describe("toRawRepo", () => {
  it("maps every FR-2 field and flattens connections", () => {
    expect(toRawRepo(edge({}, "2026-11-02T03:04:05Z"))).toEqual({
      githubId: "R_1",
      nameWithOwner: "acme/widget",
      description: "A widget",
      url: "https://github.com/acme/widget",
      homepageUrl: "https://widget.dev",
      primaryLanguage: "TypeScript",
      languages: ["TypeScript", "JavaScript", "CSS"],
      topics: ["ui", "react"],
      stargazerCount: 120,
      forkCount: 7,
      isArchived: false,
      isFork: false,
      isPrivate: false,
      pushedAt: "2026-10-01T00:00:00Z",
      createdAt: "2020-01-01T00:00:00Z",
      license: "MIT",
      starredAt: "2026-11-02T03:04:05Z",
    });
  });

  it("normalises missing and blank optional fields to null or []", () => {
    const r = toRawRepo(
      edge({
        description: "  ",
        homepageUrl: "",
        primaryLanguage: null,
        languages: null,
        repositoryTopics: { nodes: null },
        licenseInfo: null,
        pushedAt: null,
      }),
    );
    expect(r).toMatchObject({
      description: null,
      homepageUrl: null,
      primaryLanguage: null,
      languages: [],
      topics: [],
      license: null,
      pushedAt: null,
    });
  });

  it("caps languages at 3 and skips null list items", () => {
    const r = toRawRepo(
      edge({
        languages: {
          nodes: [
            null,
            { name: "a" },
            { name: "b" },
            { name: "c" },
            { name: "d" },
          ],
        },
        repositoryTopics: { nodes: [null, { topic: { name: "x" } }] },
      }),
    );
    expect(r?.languages).toEqual(["a", "b", "c"]);
    expect(r?.topics).toEqual(["x"]);
  });

  it("returns null for an edge without a node", () => {
    expect(toRawRepo({ starredAt: "2026-01-01T00:00:00Z", node: null })).toBe(
      null,
    );
  });
});

describe("filterPrivate", () => {
  const repos = [
    repo({ githubId: "a", isPrivate: false }),
    repo({ githubId: "b", isPrivate: true }),
  ];

  it("drops private repos by default (FR-11)", () => {
    expect(filterPrivate(repos, false).map((r) => r.githubId)).toEqual(["a"]);
  });

  it("keeps them when includePrivate is set", () => {
    expect(filterPrivate(repos, true).map((r) => r.githubId)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("buildStarsFile", () => {
  it("sorts by nameWithOwner and stamps version, user, lastSyncAt", () => {
    const file = buildStarsFile({
      user: "octo",
      now: "2026-11-15T00:00:00.000Z",
      repos: [
        repo({ githubId: "2", nameWithOwner: "zed/z" }),
        repo({ githubId: "1", nameWithOwner: "Acme/a" }),
        repo({ githubId: "3", nameWithOwner: "acme/b" }),
      ],
    });
    expect(file.version).toBe(1);
    expect(file.user).toBe("octo");
    expect(file.lastSyncAt).toBe("2026-11-15T00:00:00.000Z");
    expect(file.repos.map((r) => r.nameWithOwner)).toEqual([
      "Acme/a",
      "acme/b",
      "zed/z",
    ]);
  });

  it("carries README state over by githubId, also across renames", () => {
    const readme = {
      status: "ok" as const,
      fetchedForPushedAt: "2026-10-01T00:00:00Z",
    };
    const previous = buildStarsFile({
      user: "octo",
      now: "2026-11-01T00:00:00.000Z",
      repos: [repo({ githubId: "R_1", nameWithOwner: "old/name", readme })],
    });
    const next = buildStarsFile({
      user: "octo",
      now: "2026-11-15T00:00:00.000Z",
      previous,
      repos: [
        repo({ githubId: "R_1", nameWithOwner: "new/name" }),
        repo({ githubId: "R_2", nameWithOwner: "fresh/repo" }),
      ],
    });
    expect(next.repos.find((r) => r.githubId === "R_1")?.readme).toEqual(
      readme,
    );
    expect(next.repos.find((r) => r.githubId === "R_2")).not.toHaveProperty(
      "readme",
    );
  });

  it("is deterministic for the same input", () => {
    const input = {
      user: "octo",
      now: "2026-11-15T00:00:00.000Z",
      repos: [repo({ githubId: "2", nameWithOwner: "b/b" }), repo()],
    };
    expect(JSON.stringify(buildStarsFile(input))).toBe(
      JSON.stringify(
        buildStarsFile({ ...input, repos: [...input.repos].reverse() }),
      ),
    );
  });
});

describe("diffStars", () => {
  it("reports added, removed, changed and renamed by githubId", () => {
    const prev = [
      repo({ githubId: "keep", pushedAt: "2026-01-01T00:00:00Z" }),
      repo({ githubId: "push", pushedAt: "2026-01-01T00:00:00Z" }),
      repo({ githubId: "move", nameWithOwner: "old/name" }),
      repo({ githubId: "gone" }),
    ];
    const next = [
      repo({ githubId: "keep", pushedAt: "2026-01-01T00:00:00Z" }),
      repo({ githubId: "push", pushedAt: "2026-02-01T00:00:00Z" }),
      repo({ githubId: "move", nameWithOwner: "new/name" }),
      repo({ githubId: "new" }),
    ];
    const d = diffStars(prev, next);
    expect(d.added.map((r) => r.githubId)).toEqual(["new"]);
    expect(d.removed.map((r) => r.githubId)).toEqual(["gone"]);
    expect(d.changed.map((r) => r.githubId)).toEqual(["push"]);
    expect(d.renamed).toEqual([
      { from: "old/name", to: expect.objectContaining({ githubId: "move" }) },
    ]);
  });
});

describe("fetchStarredRepos", () => {
  it("pages with the cursor until hasNextPage is false", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        page(
          [
            edge({ id: "A", nameWithOwner: "a/a" }),
            edge({ id: "B", nameWithOwner: "b/b" }),
          ],
          "c1",
          true,
          3,
        ),
      )
      .mockResolvedValueOnce(
        page([edge({ id: "C", nameWithOwner: "c/c" })], "c2", false, 3),
      );
    const onPage = vi.fn();

    const result = await fetchStarredRepos({ graphql }, { onPage });

    expect(graphql).toHaveBeenCalledTimes(2);
    expect(graphql.mock.calls[0]).toEqual([
      STARS_QUERY,
      { first: STARS_PAGE_SIZE, after: null },
    ]);
    expect(graphql.mock.calls[1]?.[1]).toEqual({ first: 100, after: "c1" });
    expect(result.user).toBe("octo");
    expect(result.totalCount).toBe(3);
    expect(result.repos.map((r) => r.githubId)).toEqual(["A", "B", "C"]);
    expect(result.skipped).toBe(0);
    expect(onPage.mock.calls).toEqual([
      [2, 3],
      [3, 3],
    ]);
  });

  it("skips null edges and nodes and de-duplicates shifted pages", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        page(
          [null, { starredAt: "x", node: null }, edge({ id: "A" })],
          "c1",
          true,
        ),
      )
      .mockResolvedValueOnce(
        page([edge({ id: "A" }), edge({ id: "B" })], null, false),
      );

    const result = await fetchStarredRepos({ graphql });

    expect(result.repos.map((r) => r.githubId)).toEqual(["A", "B"]);
    expect(result.skipped).toBe(2);
  });

  it("handles an account with no stars", async () => {
    const graphql = vi.fn().mockResolvedValue(page(null, null, false, 0));
    const result = await fetchStarredRepos({ graphql });
    expect(result.repos).toEqual([]);
  });

  it("fails instead of looping when the cursor does not advance", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(page([edge({ id: "A" })], "c1", true))
      .mockResolvedValueOnce(page([edge({ id: "B" })], "c1", true));
    await expect(fetchStarredRepos({ graphql })).rejects.toThrow(
      /cursor did not advance/,
    );
  });
});
