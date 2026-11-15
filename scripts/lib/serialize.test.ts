import { describe, expect, it } from "vitest";
import type { GraphFile, RepoNode } from "../../src/lib/graph-schema.ts";
import { normalizeGraph, round, serializeGraph } from "./serialize.ts";

function node(id: string, extra: Partial<RepoNode> = {}): RepoNode {
  return {
    id,
    githubId: `g-${id}`,
    name: id.split("/")[1]!,
    owner: id.split("/")[0]!,
    url: `https://github.com/${id}`,
    languages: [],
    topics: [],
    stars: 1,
    forks: 0,
    isArchived: false,
    isFork: false,
    pushedAt: "2026-10-01T00:00:00Z",
    createdAt: "2020-01-01T00:00:00Z",
    starredAt: "2026-11-01T00:00:00Z",
    cluster: -1,
    x: 1.23456,
    y: -0.004,
    metrics: { degree: 1, weightedDegree: 0.123456789 },
    ...extra,
  };
}

function graph(extra: Partial<GraphFile> = {}): GraphFile {
  return {
    version: 1,
    generatedAt: "2026-11-15T00:00:00.000Z",
    user: "octo",
    clusters: [
      { id: 0, label: "A", color: "#000", size: 1 },
      { id: -1, label: "Unclustered", color: "#999", size: 1 },
    ],
    nodes: [node("b/b"), node("a/a")],
    edges: [
      {
        source: "b/b",
        target: "a/a",
        weight: 0.123456789,
        signals: {
          semantic: 0.987654321,
          topic: 1 / 3,
          sharedTopics: ["z", "a"],
          mention: true,
        },
      },
    ],
    ...extra,
  };
}

describe("round", () => {
  it("rounds half away from zero and never returns -0", () => {
    expect(round(0.12345, 4)).toBe(0.1235);
    expect(round(-0.12345, 4)).toBe(-0.1235);
    expect(Object.is(round(-0.001, 2), 0)).toBe(true);
    expect(round(2, 2)).toBe(2);
  });
});

describe("normalizeGraph", () => {
  it("sorts, orients edges and rounds", () => {
    const g = normalizeGraph(graph());
    expect(g.clusters.map((c) => c.id)).toEqual([-1, 0]);
    expect(g.nodes.map((n) => n.id)).toEqual(["a/a", "b/b"]);
    expect(g.nodes[0]).toMatchObject({
      x: 1.23,
      y: 0,
      metrics: { weightedDegree: 0.1235 },
    });
    expect(g.edges[0]).toEqual({
      source: "a/a",
      target: "b/b",
      weight: 0.1235,
      signals: {
        semantic: 0.9877,
        topic: 0.3333,
        sharedTopics: ["a", "z"],
        mention: true,
      },
    });
  });

  it("writes keys in schema order, omits empty optionals, drops unknown keys", () => {
    const shuffled = {
      ...node("a/a"),
      junk: 1,
      metrics: { weightedDegree: 0, degree: 0, betweenness: undefined },
    } as RepoNode;
    const reversed = Object.fromEntries(
      Object.entries(shuffled).reverse(),
    ) as RepoNode;
    const g = normalizeGraph(graph({ nodes: [reversed], edges: [] }));
    expect(Object.keys(g)).toEqual([
      "version",
      "generatedAt",
      "user",
      "clusters",
      "nodes",
      "edges",
    ]);
    expect(Object.keys(g.nodes[0]!)).toEqual(Object.keys(node("a/a")));
    expect(Object.keys(g.nodes[0]!.metrics)).toEqual([
      "degree",
      "weightedDegree",
    ]);
  });

  it("sorts duplicates and concepts", () => {
    const g = normalizeGraph(
      graph({
        duplicates: [["b/b", "a/a", 0.912345]],
        concepts: [
          { id: "concept:z", label: "z", repos: ["b/b", "a/a"] },
          { id: "concept:a", label: "a", repos: [] },
        ],
      }),
    );
    expect(g.duplicates).toEqual([["a/a", "b/b", 0.9123]]);
    expect(g.concepts?.map((c) => c.id)).toEqual(["concept:a", "concept:z"]);
    expect(g.concepts?.[1]?.repos).toEqual(["a/a", "b/b"]);
  });

  it("throws a readable error on schema violations", () => {
    const bad = graph({ nodes: [node("a/a", { stars: -1 })] });
    expect(() => normalizeGraph(bad)).toThrow(/schema validation/);
  });
});

describe("serializeGraph", () => {
  it("is independent of input order and ends with a newline", () => {
    const a = serializeGraph(graph());
    const g = graph();
    const b = serializeGraph({
      ...g,
      nodes: [...g.nodes].reverse(),
      clusters: [...g.clusters].reverse(),
    });
    expect(a).toBe(b);
    expect(a.endsWith("}\n")).toBe(true);
  });
});
