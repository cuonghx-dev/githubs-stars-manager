import { describe, expect, it } from "vitest";
import config from "../../config/graph.config.ts";
import { graphFileSchema } from "../../src/lib/graph-schema.ts";
import {
  M1_SIGNALS,
  UNCLUSTERED_ID,
  buildGraph,
  detectMentions,
  toRepoNode,
  type BuildGraphOptions,
} from "./graph.ts";
import { degreeMetrics } from "./metrics.ts";
import type { RawRepo } from "./stars.ts";

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
    stargazerCount: 10,
    forkCount: 1,
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

const options: BuildGraphOptions = {
  weights: config.weights,
  semanticRange: config.semanticRange,
  k: config.k,
  minWeight: config.minWeight,
  enabledSignals: M1_SIGNALS,
};

const repos: RawRepo[] = [
  repo("pmndrs/zustand", {
    topics: ["react", "state-management", "hooks"],
    description: "Bear necessities for state management in React",
    homepageUrl: "https://zustand-demo.pmnd.rs/",
    primaryLanguage: "TypeScript",
    languages: ["TypeScript", "JavaScript"],
    license: "MIT",
  }),
  repo("pmndrs/jotai", { topics: ["react", "state-management", "atomic"] }),
  repo("facebook/react", {
    topics: ["react", "ui", "javascript"],
    homepageUrl: "https://react.dev",
  }),
  repo("facebook/jest", { topics: ["testing"] }),
  repo("lone/wolf", { topics: ["rust"], pushedAt: null }),
  repo("docs/site", { topics: [] }),
];

const readmes = new Map([
  [
    "docs/site",
    "# Site\n\nBuilt with [React](https://react.dev/) and https://github.com/pmndrs/Zustand.git\n",
  ],
  [
    "pmndrs/zustand",
    "# Zustand\n\nSee https://github.com/pmndrs/zustand/tree/main for self.\n",
  ],
]);

const build = () =>
  buildGraph({
    user: "octo",
    generatedAt: "2026-11-15T00:00:00.000Z",
    repos,
    readmes,
    options,
  });

describe("detectMentions", () => {
  it("finds repo-link and homepage mentions, ignoring self-links", () => {
    const m = detectMentions(repos, readmes);
    expect(m.get("docs/site")).toEqual(["facebook/react", "pmndrs/zustand"]);
    expect(m.has("pmndrs/zustand")).toBe(false);
  });
});

describe("buildGraph", () => {
  it("produces a schema-valid GraphFile", () => {
    const { graph } = build();
    const parsed = graphFileSchema.safeParse(graph);
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it("sorts nodes by id; edges have source < target, sorted", () => {
    const { graph } = build();
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toEqual([...ids].sort());
    for (const edge of graph.edges)
      expect(edge.source < edge.target).toBe(true);
    const keys = graph.edges.map((e) => `${e.source} ${e.target}`);
    expect(keys).toEqual([...keys].sort());
  });

  it("puts every node in the Unclustered group", () => {
    const { graph } = build();
    expect(graph.clusters).toEqual([
      expect.objectContaining({
        id: UNCLUSTERED_ID,
        label: "Unclustered",
        size: repos.length,
      }),
    ]);
    expect(graph.nodes.every((n) => n.cluster === UNCLUSTERED_ID)).toBe(true);
  });

  it("keeps forced mention edges and strong topic edges, drops owner-only edges", () => {
    const { graph } = build();
    const edge = (a: string, b: string) =>
      graph.edges.find((e) => e.source === a && e.target === b);

    // Mentions: forced, weight includes the mention coefficient.
    expect(edge("docs/site", "facebook/react")?.signals).toEqual({
      mention: true,
    });
    expect(edge("docs/site", "facebook/react")?.weight).toBeCloseTo(
      0.15 / 0.38,
      10,
    );
    expect(edge("docs/site", "pmndrs/zustand")?.signals.mention).toBe(true);

    // Topic + owner: Jaccard 2/4.
    const jz = edge("pmndrs/jotai", "pmndrs/zustand");
    expect(jz?.signals).toEqual({
      topic: 0.5,
      sharedTopics: ["react", "state-management"],
      owner: true,
    });
    expect(jz?.weight).toBeCloseTo((0.2 * 0.5 + 0.03) / 0.38, 10);

    // Owner only (facebook/jest – facebook/react): 0.079 < 0.15.
    expect(edge("facebook/jest", "facebook/react")).toBeUndefined();
    // Topic 1/5 → 0.105 < 0.15.
    expect(edge("facebook/react", "pmndrs/jotai")).toBeUndefined();
  });

  it("computes degree metrics and isolated count from kept edges", () => {
    const { graph, stats } = build();
    const node = (id: string) => graph.nodes.find((n) => n.id === id)!;
    expect(node("lone/wolf").metrics).toEqual({ degree: 0, weightedDegree: 0 });
    expect(node("docs/site").metrics.degree).toBe(2);
    expect(stats.nodes).toBe(6);
    expect(stats.edges).toBe(graph.edges.length);
    expect(stats.forced).toBe(2);
    expect(stats.mentionEdges).toBe(2);
    expect(stats.isolated).toBe(
      graph.nodes.filter((n) => n.metrics.degree === 0).length,
    );
  });

  it("drops a disabled signal from both weight and breakdown", () => {
    const { graph } = buildGraph({
      user: "octo",
      generatedAt: "2026-11-15T00:00:00.000Z",
      repos,
      readmes,
      options: { ...options, enabledSignals: ["topic", "owner"] },
    });
    expect(graph.edges.some((e) => e.signals.mention)).toBe(false);
    const jz = graph.edges.find(
      (e) => e.source === "pmndrs/jotai" && e.target === "pmndrs/zustand",
    );
    expect(jz?.weight).toBeCloseTo((0.2 * 0.5 + 0.03) / 0.23, 10);
  });

  it("is deterministic and independent of input order", () => {
    const a = build().graph;
    const b = buildGraph({
      user: "octo",
      generatedAt: "2026-11-15T00:00:00.000Z",
      repos: [...repos].reverse(),
      readmes,
      options,
    }).graph;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("rejects duplicate repo names", () => {
    expect(() =>
      buildGraph({
        user: "octo",
        generatedAt: "2026-11-15T00:00:00.000Z",
        repos: [repo("a/b"), repo("a/b")],
        readmes: new Map(),
        options,
      }),
    ).toThrow(/duplicate/);
  });

  it("handles an empty star list", () => {
    const { graph } = buildGraph({
      user: "octo",
      generatedAt: "2026-11-15T00:00:00.000Z",
      repos: [],
      readmes: new Map(),
      options,
    });
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graphFileSchema.safeParse(graph).success).toBe(true);
  });
});

describe("toRepoNode", () => {
  it("maps FR-2 fields in schema order and omits empty optionals", () => {
    const node = toRepoNode(repos[0]!, "# Zustand\n\nSmall fast state.", {
      degree: 1,
      weightedDegree: 0.5,
    });
    expect(Object.keys(node)).toEqual([
      "id",
      "githubId",
      "name",
      "owner",
      "url",
      "homepage",
      "description",
      "readmeExcerpt",
      "language",
      "languages",
      "topics",
      "stars",
      "forks",
      "license",
      "isArchived",
      "isFork",
      "pushedAt",
      "createdAt",
      "starredAt",
      "cluster",
      "x",
      "y",
      "metrics",
    ]);
    expect(node.name).toBe("zustand");
    expect(node.owner).toBe("pmndrs");
    expect(node.readmeExcerpt).toContain("Small fast state.");

    const bare = toRepoNode(repo("a/b"), undefined, {
      degree: 0,
      weightedDegree: 0,
    });
    for (const key of [
      "homepage",
      "description",
      "readmeExcerpt",
      "language",
      "license",
    ]) {
      expect(bare).not.toHaveProperty(key);
    }
  });

  it("falls back to createdAt when the repo was never pushed", () => {
    const node = toRepoNode(repo("a/b", { pushedAt: null }), undefined, {
      degree: 0,
      weightedDegree: 0,
    });
    expect(node.pushedAt).toBe("2020-01-01T00:00:00Z");
  });
});

describe("degreeMetrics", () => {
  it("counts degree and sums weights; rejects unknown endpoints", () => {
    const m = degreeMetrics(
      ["a", "b", "c"],
      [
        { source: "a", target: "b", weight: 0.5 },
        { source: "a", target: "c", weight: 0.25 },
      ],
    );
    expect(m.get("a")).toEqual({ degree: 2, weightedDegree: 0.75 });
    expect(m.get("b")).toEqual({ degree: 1, weightedDegree: 0.5 });
    expect(() =>
      degreeMetrics(["a"], [{ source: "a", target: "x", weight: 1 }]),
    ).toThrow(/not a node/);
  });
});
