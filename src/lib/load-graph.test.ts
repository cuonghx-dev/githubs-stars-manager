import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildRepoGraph,
  edgeSize,
  FALLBACK_NODE_COLOR,
  graphUrl,
  loadGraph,
  NODE_SIZE_RANGE,
  nodeSize,
  type FetchLike,
} from "@/lib/load-graph";
import { graphFileSchema, type GraphFile } from "@/lib/graph-schema";

const fixtureText = readFileSync(
  new URL("./__fixtures__/graph.fixture.json", import.meta.url),
  "utf8",
);
const fixture = (): GraphFile => graphFileSchema.parse(JSON.parse(fixtureText));

const respond =
  (body: string, status = 200): FetchLike =>
  async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  });

describe("nodeSize", () => {
  it("maps 0 stars to the minimum and the max to the maximum", () => {
    expect(nodeSize(0, 1000)).toBe(NODE_SIZE_RANGE.min);
    expect(nodeSize(1000, 1000)).toBe(NODE_SIZE_RANGE.max);
  });

  it("is log-scaled and monotonic", () => {
    const a = nodeSize(10, 100_000);
    const b = nodeSize(100, 100_000);
    const c = nodeSize(1000, 100_000);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    // equal ratios of (1 + stars) give roughly equal size steps
    expect(c - b).toBeCloseTo(b - a, 0);
  });

  it("handles an all-zero graph", () => {
    expect(nodeSize(0, 0)).toBe(NODE_SIZE_RANGE.min);
  });
});

describe("edgeSize", () => {
  it("scales weight and clamps", () => {
    expect(edgeSize(0)).toBeLessThan(edgeSize(0.5));
    expect(edgeSize(0.5)).toBeLessThan(edgeSize(1));
    expect(edgeSize(2)).toBe(edgeSize(1));
    expect(edgeSize(-1)).toBe(edgeSize(0));
  });
});

describe("graphUrl", () => {
  it("joins the Vite base with graph.json", () => {
    expect(graphUrl("./")).toBe("./graph.json");
    expect(graphUrl("/stars")).toBe("/stars/graph.json");
    expect(graphUrl("/")).toBe("/graph.json");
  });
});

describe("buildRepoGraph", () => {
  it("adds every node with precomputed x/y, cluster colour and log size", () => {
    const data = fixture();
    const { graph, nodesById, clustersById } = buildRepoGraph(data);
    expect(graph.order).toBe(data.nodes.length);
    expect(nodesById.size).toBe(data.nodes.length);
    expect(clustersById.size).toBe(data.clusters.length);
    for (const node of data.nodes) {
      const attrs = graph.getNodeAttributes(node.id);
      expect(attrs.x).toBe(node.x);
      expect(attrs.y).toBe(node.y);
      expect(attrs.label).toBe(node.id);
      expect(attrs.color).toBe(
        data.clusters.find((c) => c.id === node.cluster)?.color,
      );
    }
    const maxStars = Math.max(...data.nodes.map((n) => n.stars));
    const top = data.nodes.find((n) => n.stars === maxStars)!;
    expect(graph.getNodeAttribute(top.id, "size")).toBe(NODE_SIZE_RANGE.max);
  });

  it("adds valid edges and skips dangling, self and duplicate edges", () => {
    const data = fixture();
    const [first] = data.edges;
    expect(first).toBeDefined();
    data.edges.push(
      { ...first!, source: first!.target, target: first!.source },
      { ...first!, target: "ghost/repo" },
      { ...first!, target: first!.source },
    );
    const { graph } = buildRepoGraph(data);
    expect(graph.size).toBe(data.edges.length - 3);
    expect(graph.getEdgeAttribute(first!.source, first!.target, "weight")).toBe(
      first!.weight,
    );
  });

  it("falls back to a neutral colour for unknown clusters", () => {
    const data = fixture();
    data.nodes[0]!.cluster = 999;
    const { graph } = buildRepoGraph(data);
    expect(graph.getNodeAttribute(data.nodes[0]!.id, "color")).toBe(
      FALLBACK_NODE_COLOR,
    );
  });
});

describe("loadGraph", () => {
  it("returns the graph for a valid file", async () => {
    const result = await loadGraph("/graph.json", respond(fixtureText));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.graph.graph.order).toBe(fixture().nodes.length);
    expect(result.graph.data.generatedAt).toBe(fixture().generatedAt);
  });

  it("reports a 404 as missing", async () => {
    const result = await loadGraph("/graph.json", respond("", 404));
    expect(result).toMatchObject({ status: "missing" });
  });

  it("reports a network error as missing", async () => {
    const result = await loadGraph("/graph.json", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(result).toMatchObject({ status: "missing" });
    expect(result.status !== "ok" && result.message).toContain(
      "Failed to fetch",
    );
  });

  it("treats the dev server's HTML fallback as missing", async () => {
    const result = await loadGraph(
      "/graph.json",
      respond("<!doctype html><html></html>"),
    );
    expect(result).toMatchObject({ status: "missing" });
  });

  it("reports malformed JSON as invalid", async () => {
    const result = await loadGraph("/graph.json", respond("{ nope"));
    expect(result).toMatchObject({ status: "invalid" });
  });

  it("reports a schema violation as invalid", async () => {
    const bad = JSON.parse(fixtureText) as { nodes: unknown };
    bad.nodes = "nope";
    const result = await loadGraph("/graph.json", respond(JSON.stringify(bad)));
    expect(result).toMatchObject({ status: "invalid" });
  });

  it("reports an unknown version separately", async () => {
    const bad = { ...JSON.parse(fixtureText), version: 2 };
    const result = await loadGraph("/graph.json", respond(JSON.stringify(bad)));
    expect(result).toMatchObject({ status: "unsupported-version" });
  });

  it("loads the pipeline's golden output (contract test)", async () => {
    const golden = readFileSync(
      new URL(
        "../../scripts/__fixtures__/golden/graph.golden.json",
        import.meta.url,
      ),
      "utf8",
    );
    const result = await loadGraph("/graph.json", respond(golden));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const parsed = JSON.parse(golden) as GraphFile;
    expect(result.graph.graph.order).toBe(parsed.nodes.length);
    expect(result.graph.graph.size).toBe(parsed.edges.length);
  });
});
