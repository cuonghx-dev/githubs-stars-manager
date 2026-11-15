import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeJsonAtomic } from "./lib/fs-atomic.ts";
import { GhError, type GhClient } from "./lib/gh.ts";
import { createLogger } from "./lib/log.ts";
import type { GqlStarEdge, StarsFile, StarsPage } from "./lib/stars.ts";
import { runSync, type SyncDeps } from "./sync.ts";

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

function fakeGh(edges: GqlStarEdge[], readmes: Record<string, string> = {}) {
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
  const api = vi.fn(async (path: string) => {
    const name = /^repos\/(.+)\/readme$/.exec(path)?.[1] ?? "";
    const text = readmes[name];
    if (text === undefined) {
      throw new GhError("Not Found (HTTP 404)", "http", 404, "", 1);
    }
    return text;
  });
  const gh: GhClient = {
    api,
    apiJson: vi.fn(),
    graphql: vi.fn().mockResolvedValue(page) as GhClient["graphql"],
    assertAuth: vi.fn().mockResolvedValue(undefined),
  };
  return Object.assign(gh, { api });
}

describe("runSync", () => {
  let dir: string;
  let starsPath: string;
  let readmesDir: string;
  let lines: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sync-test-"));
    starsPath = join(dir, "data/raw/stars.json");
    readmesDir = join(dir, "data/raw/readmes");
    lines = [];
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const run = (gh: GhClient, extra: Partial<SyncDeps> = {}) =>
    runSync({
      gh,
      logger: createLogger({
        write: (l) => lines.push(l),
        writeError: (l) => lines.push(l),
        now: () => 0,
      }),
      starsPath,
      readmesDir,
      includePrivate: false,
      readmeConcurrency: 8,
      full: false,
      now: () => new Date("2026-11-15T00:00:00Z"),
      ...extra,
    });

  it("checks auth, drops private repos, fetches READMEs, writes stars.json", async () => {
    const gh = fakeGh(
      [
        edge("R_2", "zed/b"),
        edge("R_1", "acme/a"),
        edge("R_3", "me/secret", { isPrivate: true }),
      ],
      { "acme/a": "# A\n", "me/secret": "# secret\n" },
    );

    await run(gh);

    expect(gh.assertAuth).toHaveBeenCalledOnce();
    const file = JSON.parse(await readFile(starsPath, "utf8")) as StarsFile;
    expect(file).toMatchObject({
      version: 1,
      user: "octo",
      lastSyncAt: "2026-11-15T00:00:00.000Z",
    });
    expect(file.repos.map((r) => [r.nameWithOwner, r.readme?.status])).toEqual([
      ["acme/a", "ok"],
      ["zed/b", "missing"],
    ]);
    expect(JSON.stringify(file)).not.toContain("secret");
    expect(await readdir(readmesDir)).toEqual(["acme__a.md"]);
    expect(gh.api).toHaveBeenCalledTimes(2);
    expect(lines.at(-1)).toBe(
      "[sync] stars=2 private=1 added=2 removed=0 changed=0 renamed=0 cached=0 fetched=1 missing=1 (0ms)",
    );
  });

  it("second run with no changes fetches nothing", async () => {
    const edges = [edge("R_1", "acme/a"), edge("R_2", "zed/b")];
    await run(fakeGh(edges, { "acme/a": "# A\n" }));
    const gh = fakeGh(edges, { "acme/a": "# A\n" });
    lines = [];

    await run(gh);

    expect(gh.api).not.toHaveBeenCalled();
    expect(lines.at(-1)).toBe(
      "[sync] stars=2 private=0 added=0 removed=0 changed=0 renamed=0 cached=2 (0ms)",
    );

    lines = [];
    const full = fakeGh(edges, { "acme/a": "# A\n" });
    await run(full, { full: true });
    expect(full.api).toHaveBeenCalledTimes(2);
  });

  it("diffs against the previous file: rename, removal, push", async () => {
    const readme = { status: "ok", fetchedForPushedAt: "2026-10-01T00:00:00Z" };
    await writeJsonAtomic(starsPath, {
      version: 1,
      user: "octo",
      lastSyncAt: "2026-11-01T00:00:00.000Z",
      repos: [
        { ...edge("R_1", "acme/old").node, githubId: "R_1", readme },
        { ...edge("R_8", "acme/moved").node, githubId: "R_8", readme },
        { githubId: "R_9", nameWithOwner: "gone/repo", pushedAt: null, readme },
      ],
    });
    await mkdir(readmesDir, { recursive: true });
    await writeFile(join(readmesDir, "acme__old.md"), "old");
    await writeFile(join(readmesDir, "acme__moved.md"), "moved");
    await writeFile(join(readmesDir, "gone__repo.md"), "gone");
    const gh = fakeGh(
      [
        edge("R_1", "acme/new", { pushedAt: "2026-11-10T00:00:00Z" }),
        edge("R_8", "other/moved"),
        edge("R_2", "fresh/repo"),
      ],
      { "acme/new": "new" },
    );

    const file = await run(gh);

    expect(file.repos.find((r) => r.githubId === "R_1")?.readme).toEqual({
      status: "ok",
      fetchedForPushedAt: "2026-11-10T00:00:00Z",
    });
    expect((await readdir(readmesDir)).sort()).toEqual([
      "acme__new.md",
      "other__moved.md",
    ]);
    expect(await readFile(join(readmesDir, "other__moved.md"), "utf8")).toBe(
      "moved",
    );
    expect(lines).toContain("[sync] renamed acme/old -> acme/new");
    expect(lines.at(-1)).toBe(
      "[sync] stars=3 private=0 added=1 removed=1 changed=1 renamed=2 deleted=1 moved=2 cached=1 fetched=1 missing=1 (0ms)",
    );
  });

  it("ignores a previous file from another user", async () => {
    await writeJsonAtomic(starsPath, {
      version: 1,
      user: "someone-else",
      lastSyncAt: "2026-11-01T00:00:00.000Z",
      repos: [{ githubId: "R_9", nameWithOwner: "x/y", pushedAt: null }],
    });
    await run(fakeGh([edge("R_1", "acme/a")]), { includePrivate: true });
    expect(lines.at(-1)).toContain("added=1 removed=0");
  });
});
