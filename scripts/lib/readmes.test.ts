import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GhError, type GhClient } from "./gh.ts";
import {
  RAW_ACCEPT,
  fetchReadme,
  planReadmes,
  pushedKey,
  readmePath,
  syncReadmes,
  type ReadmeLog,
} from "./readmes.ts";
import type { RawRepo } from "./stars.ts";

function repo(
  githubId: string,
  nameWithOwner: string,
  extra: Partial<RawRepo> = {},
): RawRepo {
  return {
    githubId,
    nameWithOwner,
    description: null,
    url: `https://github.com/${nameWithOwner}`,
    homepageUrl: null,
    primaryLanguage: null,
    languages: [],
    topics: [],
    stargazerCount: 1,
    forkCount: 0,
    isArchived: false,
    isFork: false,
    isPrivate: false,
    pushedAt: "2026-10-01T00:00:00Z",
    createdAt: "2020-01-01T00:00:00Z",
    license: null,
    starredAt: "2026-11-01T00:00:00Z",
    ...extra,
  };
}

const ok = (pushedAt = "2026-10-01T00:00:00Z") => ({
  status: "ok" as const,
  fetchedForPushedAt: pushedAt,
});

function notFound(): GhError {
  return new GhError("Not Found (HTTP 404)", "http", 404, "HTTP 404", 1);
}

/** Fake `gh api`: README text by `owner/repo`; absent -> 404. */
function fakeApi(readmes: Record<string, string | Error>) {
  return vi.fn(async (path: string) => {
    const name = /^repos\/(.+)\/readme$/.exec(path)?.[1] ?? "";
    const value = readmes[name];
    if (value instanceof Error) throw value;
    if (value === undefined) throw notFound();
    return value;
  });
}

function fakeLog() {
  const counts: Record<string, number> = {};
  const warnings: string[] = [];
  const log: ReadmeLog = {
    info: () => {},
    warn: (m) => warnings.push(m),
    count: (k, n = 1) => {
      counts[k] = (counts[k] ?? 0) + n;
    },
  };
  return { log, counts, warnings };
}

describe("readmePath / pushedKey", () => {
  it("maps owner/repo to owner__repo.md", () => {
    expect(readmePath("/d", "acme/widget.js")).toBe("/d/acme__widget.js.md");
  });
  it("uses an empty key for never-pushed repos", () => {
    expect(pushedKey({ pushedAt: null })).toBe("");
  });
});

describe("fetchReadme", () => {
  it("requests the raw README", async () => {
    const api = vi.fn().mockResolvedValue("# Hi\n");
    await expect(fetchReadme({ api }, "acme/a")).resolves.toEqual({
      status: "ok",
      text: "# Hi\n",
    });
    expect(api).toHaveBeenCalledWith("repos/acme/a/readme", {
      headers: { Accept: RAW_ACCEPT },
    });
  });

  it("maps 404 to missing and rethrows other errors", async () => {
    await expect(
      fetchReadme({ api: vi.fn().mockRejectedValue(notFound()) }, "a/b"),
    ).resolves.toEqual({ status: "missing" });
    const boom = new GhError("HTTP 403", "http", 403, "", 1);
    await expect(
      fetchReadme({ api: vi.fn().mockRejectedValue(boom) }, "a/b"),
    ).rejects.toBe(boom);
  });
});

describe("planReadmes", () => {
  const previous = [
    repo("same", "a/same", { readme: ok() }),
    repo("pushed", "a/pushed", { readme: ok("2026-01-01T00:00:00Z") }),
    repo("renamed", "old/name", { readme: ok() }),
    repo("nofile", "a/nofile", {
      readme: { status: "missing", fetchedForPushedAt: "2026-10-01T00:00:00Z" },
    }),
    repo("gone", "a/gone", { readme: ok() }),
    repo("gone-missing", "a/gone-missing", {
      readme: { status: "missing", fetchedForPushedAt: "x" },
    }),
  ];
  const next = [
    repo("same", "a/same"),
    repo("pushed", "a/pushed"),
    repo("renamed", "new/name"),
    repo("nofile", "a/nofile"),
    repo("new", "a/new"),
  ];

  it("reuses unchanged, fetches pushed and new, moves renamed, deletes gone", () => {
    const plan = planReadmes({ dir: "/d", previous, next, full: false });
    expect([...plan.reuse.keys()]).toEqual(["same", "renamed", "nofile"]);
    expect(plan.fetch.map((r) => r.githubId)).toEqual(["pushed", "new"]);
    expect(plan.moves).toEqual([
      { from: "/d/old__name.md", to: "/d/new__name.md" },
    ]);
    expect(plan.deletes).toEqual(["/d/a__gone.md"]);
  });

  it("--full fetches everything but still moves and deletes", () => {
    const plan = planReadmes({ dir: "/d", previous, next, full: true });
    expect(plan.reuse.size).toBe(0);
    expect(plan.fetch).toHaveLength(5);
    expect(plan.moves).toHaveLength(1);
    expect(plan.deletes).toEqual(["/d/a__gone.md"]);
  });
});

describe("syncReadmes", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "readmes-test-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("first run fetches all, writes files, records ok/missing", async () => {
    const api = fakeApi({ "a/one": "# One\n" });
    const { log, counts } = fakeLog();
    const out = await syncReadmes({
      gh: { api } as unknown as GhClient,
      dir,
      previous: [],
      next: [repo("1", "a/one"), repo("2", "a/two", { pushedAt: null })],
      full: false,
      concurrency: 8,
      log,
    });
    expect(await readFile(join(dir, "a__one.md"), "utf8")).toBe("# One\n");
    expect(await readdir(dir)).toEqual(["a__one.md"]);
    expect(out.map((r) => r.readme)).toEqual([
      ok(),
      { status: "missing", fetchedForPushedAt: "" },
    ]);
    expect(counts).toEqual({ cached: 0, fetched: 1, missing: 1 });
  });

  it("incremental run: cache hit, rename move, removal delete, refetch on push", async () => {
    await writeFile(join(dir, "a__same.md"), "same");
    await writeFile(join(dir, "old__name.md"), "renamed");
    await writeFile(join(dir, "a__gone.md"), "gone");
    await writeFile(join(dir, "a__pushed.md"), "stale");
    const api = fakeApi({ "a/pushed": "fresh" });
    const { log, counts } = fakeLog();

    const out = await syncReadmes({
      gh: { api } as unknown as GhClient,
      dir,
      previous: [
        repo("same", "a/same", { readme: ok() }),
        repo("renamed", "old/name", { readme: ok() }),
        repo("gone", "a/gone", { readme: ok() }),
        repo("pushed", "a/pushed", { readme: ok("2026-01-01T00:00:00Z") }),
      ],
      next: [
        repo("same", "a/same"),
        repo("renamed", "new/name"),
        repo("pushed", "a/pushed"),
      ],
      full: false,
      concurrency: 2,
      log,
    });

    expect(api).toHaveBeenCalledTimes(1);
    expect((await readdir(dir)).sort()).toEqual([
      "a__pushed.md",
      "a__same.md",
      "new__name.md",
    ]);
    expect(await readFile(join(dir, "new__name.md"), "utf8")).toBe("renamed");
    expect(await readFile(join(dir, "a__pushed.md"), "utf8")).toBe("fresh");
    expect(
      out.every((r) => r.readme?.fetchedForPushedAt === "2026-10-01T00:00:00Z"),
    ).toBe(true);
    expect(counts).toEqual({ deleted: 1, moved: 1, cached: 2, fetched: 1 });
  });

  it("refetches a cached ok whose file vanished", async () => {
    const api = fakeApi({ "a/x": "back" });
    const { log } = fakeLog();
    await syncReadmes({
      gh: { api } as unknown as GhClient,
      dir,
      previous: [repo("x", "a/x", { readme: ok() })],
      next: [repo("x", "a/x")],
      full: false,
      concurrency: 1,
      log,
    });
    expect(await readFile(join(dir, "a__x.md"), "utf8")).toBe("back");
  });

  it("a README that disappears upstream removes the stale file", async () => {
    await writeFile(join(dir, "a__x.md"), "old");
    const { log } = fakeLog();
    const out = await syncReadmes({
      gh: { api: fakeApi({}) } as unknown as GhClient,
      dir,
      previous: [repo("x", "a/x", { readme: ok("2026-01-01T00:00:00Z") })],
      next: [repo("x", "a/x")],
      full: false,
      concurrency: 1,
      log,
    });
    expect(await readdir(dir)).toEqual([]);
    expect(out[0]?.readme?.status).toBe("missing");
  });

  it("a failed fetch warns and keeps the previous state for a retry", async () => {
    const boom = new GhError("HTTP 502", "server", 502, "", 1);
    const { log, counts, warnings } = fakeLog();
    const old = ok("2026-01-01T00:00:00Z");
    const out = await syncReadmes({
      gh: { api: fakeApi({ "a/x": boom, "a/y": boom }) } as unknown as GhClient,
      dir,
      previous: [repo("x", "a/x", { readme: old })],
      next: [repo("x", "a/x"), repo("y", "a/y")],
      full: false,
      concurrency: 2,
      log,
    });
    expect(out[0]?.readme).toEqual(old);
    expect(out[1]).not.toHaveProperty("readme");
    expect(counts.failed).toBe(2);
    expect(warnings[0]).toContain("README a/x");
  });

  it("caps concurrent fetches at the configured limit", async () => {
    let active = 0;
    let peak = 0;
    const api = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return "x";
    });
    const { log } = fakeLog();
    await syncReadmes({
      gh: { api } as unknown as GhClient,
      dir,
      previous: [],
      next: Array.from({ length: 20 }, (_, i) => repo(`${i}`, `o/r${i}`)),
      full: false,
      concurrency: 3,
      log,
    });
    expect(api).toHaveBeenCalledTimes(20);
    expect(peak).toBe(3);
  });
});
