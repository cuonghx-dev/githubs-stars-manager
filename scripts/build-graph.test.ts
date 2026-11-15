import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import config from "../config/graph.config.ts";
import { graphFileSchema } from "../src/lib/graph-schema.ts";
import { runBuildGraph, type BuildGraphDeps } from "./build-graph.ts";
import { writeJsonAtomic } from "./lib/fs-atomic.ts";
import { M1_SIGNALS } from "./lib/graph.ts";
import { createLogger } from "./lib/log.ts";
import type { RawRepo, StarsFile } from "./lib/stars.ts";

function repo(nameWithOwner: string, extra: Partial<RawRepo> = {}): RawRepo {
  return {
    githubId: `id-${nameWithOwner}`,
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
    readme: { status: "missing", fetchedForPushedAt: "2026-10-01T00:00:00Z" },
    ...extra,
  };
}

let dir: string;
let lines: string[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "build-graph-"));
  lines = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function deps(extra: Partial<BuildGraphDeps> = {}): BuildGraphDeps {
  return {
    logger: createLogger({
      write: (l) => lines.push(l),
      writeError: (l) => lines.push(l),
      now: () => 0,
    }),
    starsPath: join(dir, "raw/stars.json"),
    readmesDir: join(dir, "raw/readmes"),
    graphPath: join(dir, "public/graph.json"),
    includePrivate: false,
    options: {
      weights: config.weights,
      semanticRange: config.semanticRange,
      k: config.k,
      minWeight: config.minWeight,
      enabledSignals: M1_SIGNALS,
      layout: config.layout,
    },
    now: () => new Date("2026-11-15T00:00:00Z"),
    ...extra,
  };
}

async function writeStars(repos: RawRepo[]): Promise<void> {
  const file: StarsFile = {
    version: 1,
    user: "octo",
    lastSyncAt: "2026-11-15T00:00:00Z",
    repos,
  };
  await writeJsonAtomic(join(dir, "raw/stars.json"), file);
}

describe("runBuildGraph", () => {
  it("reads stars + READMEs and writes a valid graph.json", async () => {
    const ok = { status: "ok" as const, fetchedForPushedAt: "x" };
    await writeStars([
      repo("a/app", { readme: ok }),
      repo("b/lib", { topics: ["x"] }),
      repo("c/lib", { topics: ["x"] }),
      repo("secret/repo", { isPrivate: true, topics: ["x"] }),
      repo("d/gone", { readme: ok }), // README file missing on disk
    ]);
    await mkdir(join(dir, "raw/readmes"), { recursive: true });
    await writeFile(
      join(dir, "raw/readmes/a__app.md"),
      "Uses https://github.com/b/lib\n",
    );

    const graph = await runBuildGraph(deps());
    const written = JSON.parse(
      await readFile(join(dir, "public/graph.json"), "utf8"),
    ) as unknown;
    expect(written).toEqual(graph);
    expect(graphFileSchema.safeParse(written).success).toBe(true);

    expect(graph.user).toBe("octo");
    expect(graph.generatedAt).toBe("2026-11-15T00:00:00.000Z");
    expect(graph.nodes.map((n) => n.id)).toEqual([
      "a/app",
      "b/lib",
      "c/lib",
      "d/gone",
    ]);
    expect(
      graph.edges.map((e) => [e.source, e.target, e.signals.mention ?? false]),
    ).toEqual([
      ["a/app", "b/lib", true],
      ["b/lib", "c/lib", false],
    ]);
    expect(lines.at(-1)).toMatch(
      /^\[build-graph\] readmeMissingFile=1 nodes=4 candidates=2 edges=2 forced=1 mentions=1 isolated=1 kb=\d+ \(0ms\)$/,
    );
  });

  it("fails with a clear message when stars.json is missing", async () => {
    await expect(runBuildGraph(deps())).rejects.toThrow(/pnpm sync/);
  });

  it("rejects a stars.json with another version", async () => {
    await writeJsonAtomic(join(dir, "raw/stars.json"), {
      version: 99,
      user: "octo",
      lastSyncAt: "",
      repos: [],
    });
    await expect(runBuildGraph(deps())).rejects.toThrow(/version 99/);
  });
});

// Golden test (NFR-4, plan §6): build the 12-repo fixture twice and require
// byte-identical output apart from `generatedAt`, then compare with the
// committed snapshot. Regenerate with `pnpm exec vitest run -u` after an
// intentional change to signals, weights, layout or serialisation.
describe("build-graph golden", () => {
  const fixture = resolve(import.meta.dirname, "__fixtures__/golden");

  async function buildAt(iso: string): Promise<string> {
    await runBuildGraph(deps({ now: () => new Date(iso) }));
    return readFile(join(dir, "public/graph.json"), "utf8");
  }

  it("is byte-identical across runs apart from generatedAt", async () => {
    await cp(join(fixture, "raw"), join(dir, "raw"), { recursive: true });

    const first = await buildAt("2026-11-15T00:00:00Z");
    const second = await buildAt("2027-01-02T03:04:05Z");
    expect(first).toContain('"generatedAt": "2026-11-15T00:00:00.000Z"');
    expect(second).toContain('"generatedAt": "2027-01-02T03:04:05.000Z"');
    const strip = (t: string) =>
      t.replace(/"generatedAt": "[^"]*"/, '"generatedAt": ""');
    expect(strip(second)).toBe(strip(first));

    const graph = graphFileSchema.parse(JSON.parse(first));
    expect(graph.nodes).toHaveLength(12); // private repo filtered out
    expect(graph.nodes.some((n) => n.x !== 0 || n.y !== 0)).toBe(true);
    for (const n of graph.nodes) {
      expect(Math.round(n.x * 100) / 100).toBe(n.x);
      expect(Math.round(n.y * 100) / 100).toBe(n.y);
    }
    for (const e of graph.edges) {
      expect(Math.round(e.weight * 1e4) / 1e4).toBe(e.weight);
    }

    await expect(first).toMatchFileSnapshot(join(fixture, "graph.golden.json"));
  });
});
