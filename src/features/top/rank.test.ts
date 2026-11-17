import { describe, expect, it } from "vitest";
import { clampPage, pageCount, rankTopRepos } from "@/features/top/rank";
import type { RepoNode } from "@/lib/graph-schema";

function node(id: string, stars: number, degree: number): RepoNode {
  const [owner = "", name = ""] = id.split("/");
  return {
    id,
    githubId: `R_${id}`,
    name,
    owner,
    url: `https://github.com/${id}`,
    languages: [],
    topics: [],
    stars,
    forks: 0,
    isArchived: false,
    isFork: false,
    pushedAt: "2026-01-01T00:00:00Z",
    createdAt: "2020-01-01T00:00:00Z",
    starredAt: "2024-01-01T00:00:00Z",
    cluster: 0,
    x: 0,
    y: 0,
    metrics: { degree, weightedDegree: degree },
  };
}

const nodes = [
  node("a/huge-lonely", 500_000, 0),
  node("b/hub", 1_000, 40),
  node("c/balanced", 100_000, 30),
  node("d/small", 50, 2),
];

const ids = (rows: { repo: RepoNode }[]) => rows.map((r) => r.repo.id);

describe("rankTopRepos", () => {
  it("sorts by stars", () => {
    expect(ids(rankTopRepos(nodes, { key: "stars", asc: false }))).toEqual([
      "a/huge-lonely",
      "c/balanced",
      "b/hub",
      "d/small",
    ]);
  });

  it("sorts by links", () => {
    expect(ids(rankTopRepos(nodes, { key: "links", asc: false }))).toEqual([
      "b/hub",
      "c/balanced",
      "d/small",
      "a/huge-lonely",
    ]);
  });

  it("combined score favours repos high on both axes", () => {
    const rows = rankTopRepos(nodes);
    expect(rows[0]?.repo.id).toBe("c/balanced");
    expect(rows[0]?.score).toBeCloseTo((2 / 3 + 2 / 3) / 2);
    expect(rows.at(-1)?.repo.id).toBe("d/small");
  });

  it("gives ties the same percentile and breaks them by id", () => {
    const tied = [node("y/two", 10, 5), node("x/one", 10, 5)];
    const rows = rankTopRepos(tied);
    expect(ids(rows)).toEqual(["x/one", "y/two"]);
    expect(rows[0]?.score).toBe(0.5);
  });

  it("returns every repo, not a fixed top slice", () => {
    const many = Array.from({ length: 120 }, (_, i) => node(`o/r${i}`, i, 0));
    expect(rankTopRepos(many)).toHaveLength(120);
  });

  it("sorts ascending when asked", () => {
    expect(ids(rankTopRepos(nodes, { key: "stars", asc: true }))).toEqual([
      "d/small",
      "b/hub",
      "c/balanced",
      "a/huge-lonely",
    ]);
  });

  it("sorts by name, case-insensitive", () => {
    const named = [node("b/x", 1, 0), node("A/y", 1, 0), node("c/z", 1, 0)];
    expect(ids(rankTopRepos(named, { key: "name", asc: true }))).toEqual([
      "A/y",
      "b/x",
      "c/z",
    ]);
  });

  it("sorts by starred date, newest first", () => {
    const old = { ...node("o/old", 1, 0), starredAt: "2020-01-01T00:00:00Z" };
    const fresh = { ...node("n/new", 1, 0), starredAt: "2025-06-01T00:00:00Z" };
    expect(
      ids(rankTopRepos([old, fresh], { key: "starred", asc: false })),
    ).toEqual(["n/new", "o/old"]);
  });

  it("handles empty and single-node graphs", () => {
    expect(rankTopRepos([])).toEqual([]);
    expect(rankTopRepos([node("z/solo", 1, 0)])[0]?.score).toBe(1);
  });
});

describe("pagination helpers", () => {
  it("counts pages, at least one", () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
  });

  it("clamps the page into range", () => {
    expect(clampPage(-1, 120, 50)).toBe(0);
    expect(clampPage(5, 120, 50)).toBe(2);
    expect(clampPage(1, 120, 50)).toBe(1);
  });
});
