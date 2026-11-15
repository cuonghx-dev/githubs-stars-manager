import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeJsonAtomic } from "./lib/fs-atomic.ts";
import type { GhClient } from "./lib/gh.ts";
import { createLogger } from "./lib/log.ts";
import type { GqlStarEdge, StarsFile, StarsPage } from "./lib/stars.ts";
import { runSync } from "./sync.ts";

function edge(
  id: string,
  nameWithOwner: string,
  extra: { isPrivate?: boolean; pushedAt?: string } = {},
): GqlStarEdge {
  return {
    starredAt: "2026-11-01T00:00:00Z",
    node: {
      id,
      nameWithOwner,
      description: null,
      url: `https://github.com/${nameWithOwner}`,
      homepageUrl: null,
      primaryLanguage: null,
      languages: { nodes: [] },
      repositoryTopics: { nodes: [] },
      stargazerCount: 1,
      forkCount: 0,
      isArchived: false,
      isFork: false,
      isPrivate: extra.isPrivate ?? false,
      pushedAt: extra.pushedAt ?? "2026-10-01T00:00:00Z",
      createdAt: "2020-01-01T00:00:00Z",
      licenseInfo: null,
    },
  };
}

function fakeGh(edges: GqlStarEdge[]): GhClient {
  const page: StarsPage = {
    viewer: {
      login: "octo",
      starredRepositories: {
        totalCount: edges.length,
        pageInfo: { hasNextPage: false, endCursor: null },
        edges,
      },
    },
  };
  return {
    api: vi.fn(),
    apiJson: vi.fn(),
    graphql: vi.fn().mockResolvedValue(page) as GhClient["graphql"],
    assertAuth: vi.fn().mockResolvedValue(undefined),
  };
}

describe("runSync", () => {
  let dir: string;
  let starsPath: string;
  let lines: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sync-test-"));
    starsPath = join(dir, "data/raw/stars.json");
    lines = [];
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const logger = () =>
    createLogger({
      write: (l) => lines.push(l),
      writeError: (l) => lines.push(l),
      now: () => 0,
    });

  it("checks auth, drops private repos and writes stars.json", async () => {
    const gh = fakeGh([
      edge("R_2", "zed/b"),
      edge("R_1", "acme/a"),
      edge("R_3", "me/secret", { isPrivate: true }),
    ]);

    await runSync({
      gh,
      logger: logger(),
      starsPath,
      includePrivate: false,
      now: () => new Date("2026-11-15T00:00:00Z"),
    });

    expect(gh.assertAuth).toHaveBeenCalledOnce();
    const file = JSON.parse(await readFile(starsPath, "utf8")) as StarsFile;
    expect(file).toMatchObject({
      version: 1,
      user: "octo",
      lastSyncAt: "2026-11-15T00:00:00.000Z",
    });
    expect(file.repos.map((r) => r.nameWithOwner)).toEqual(["acme/a", "zed/b"]);
    expect(JSON.stringify(file)).not.toContain("secret");
    expect(lines.at(-1)).toBe(
      "[sync] stars=2 private=1 added=2 removed=0 changed=0 renamed=0 (0ms)",
    );
  });

  it("diffs against the previous file and keeps README state", async () => {
    const readme = { status: "ok", fetchedForPushedAt: "2026-10-01T00:00:00Z" };
    await writeJsonAtomic(starsPath, {
      version: 1,
      user: "octo",
      lastSyncAt: "2026-11-01T00:00:00.000Z",
      repos: [
        { ...edge("R_1", "acme/old").node, githubId: "R_1", readme },
        { githubId: "R_9", nameWithOwner: "gone/repo", pushedAt: null },
      ],
    });
    const gh = fakeGh([
      edge("R_1", "acme/new", { pushedAt: "2026-11-10T00:00:00Z" }),
      edge("R_2", "fresh/repo"),
    ]);

    const file = await runSync({
      gh,
      logger: logger(),
      starsPath,
      includePrivate: false,
      now: () => new Date("2026-11-15T00:00:00Z"),
    });

    expect(file.repos.find((r) => r.githubId === "R_1")?.readme).toEqual(
      readme,
    );
    expect(lines).toContain("[sync] renamed acme/old -> acme/new");
    expect(lines.at(-1)).toBe(
      "[sync] stars=2 private=0 added=1 removed=1 changed=1 renamed=1 (0ms)",
    );
  });

  it("ignores a previous file from another user", async () => {
    await writeJsonAtomic(starsPath, {
      version: 1,
      user: "someone-else",
      lastSyncAt: "2026-11-01T00:00:00.000Z",
      repos: [{ githubId: "R_9", nameWithOwner: "x/y", pushedAt: null }],
    });
    await runSync({
      gh: fakeGh([edge("R_1", "acme/a")]),
      logger: logger(),
      starsPath,
      includePrivate: true,
      now: () => new Date("2026-11-15T00:00:00Z"),
    });
    expect(lines.at(-1)).toContain("added=1 removed=0");
  });
});
