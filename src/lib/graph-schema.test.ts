import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/graph.fixture.json";
import {
  GRAPH_FILE_VERSION,
  graphFileSchema,
  parseGraphFile,
  type GraphFile,
} from "./graph-schema";

const clone = (): Record<string, unknown> => structuredClone(fixture);

describe("graphFileSchema", () => {
  it("accepts the hand-written fixture", () => {
    const parsed = graphFileSchema.parse(fixture);
    expect(parsed.version).toBe(GRAPH_FILE_VERSION);
    expect(parsed.nodes).toHaveLength(3);
    expect(parsed.edges[0]?.signals.sharedTopics).toEqual(["react", "ui"]);
  });

  it("round-trips the fixture unchanged", () => {
    expect(graphFileSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts a minimal file without optional sections", () => {
    const minimal: GraphFile = {
      version: 1,
      generatedAt: "2026-11-15T00:00:00Z",
      user: "octocat",
      clusters: [],
      nodes: [],
      edges: [],
    };
    expect(graphFileSchema.safeParse(minimal).success).toBe(true);
  });

  it("strips unknown keys", () => {
    const data = { ...clone(), extra: true };
    expect(graphFileSchema.parse(data)).not.toHaveProperty("extra");
  });

  /* eslint-disable @typescript-eslint/no-explicit-any -- mutations deliberately break the typed shape */
  it.each([
    ["missing user", (d: any) => delete d.user],
    ["non-ISO generatedAt", (d: any) => (d.generatedAt = "yesterday")],
    ["edge weight > 1", (d: any) => (d.edges[0].weight = 1.5)],
    ["negative stars", (d: any) => (d.nodes[0].stars = -1)],
    ["bad repo id", (d: any) => (d.nodes[0].id = "react")],
    ["more than 3 languages", (d: any) => d.nodes[0].languages.push("CSS")],
    ["unknown category", (d: any) => (d.nodes[0].enrichment.category = "x")],
    ["cluster id < -1", (d: any) => (d.clusters[0].id = -2)],
    ["concept id prefix", (d: any) => (d.concepts[0].id = "virtual-dom")],
  ])("rejects %s", (_name, mutate) => {
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const data = clone();
    mutate(data);
    expect(graphFileSchema.safeParse(data).success).toBe(false);
  });
});

describe("parseGraphFile", () => {
  it("returns typed data for a valid file", () => {
    const result = parseGraphFile(fixture);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.user).toBe("octocat");
  });

  it("flags an unknown version separately", () => {
    const result = parseGraphFile({ ...clone(), version: 2 });
    expect(result).toMatchObject({ ok: false, reason: "unsupported-version" });
  });

  it("reports shape errors with a readable message", () => {
    const data = clone();
    delete data.nodes;
    const result = parseGraphFile(data);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (!result.ok) expect(result.message).toContain("nodes");
  });

  it.each([null, "graph", 42, []])("rejects non-object input %j", (input) => {
    expect(parseGraphFile(input).ok).toBe(false);
  });
});
