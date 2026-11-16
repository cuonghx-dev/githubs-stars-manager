import { describe, expect, it } from "vitest";
import { rankTopRepos } from "@/features/top/rank";
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
    expect(ids(rankTopRepos(nodes, "stars"))).toEqual([
      "a/huge-lonely",
      "c/balanced",
      "b/hub",
      "d/small",
    ]);
  });

  it("sorts by links", () => {
    expect(ids(rankTopRepos(nodes, "links"))).toEqual([
      "b/hub",
      "c/balanced",
      "d/small",
      "a/huge-lonely",
    ]);
  });

  it("combined score favours repos high on both axes", () => {
    const rows = rankTopRepos(nodes, "score");
    expect(rows[0]?.repo.id).toBe("c/balanced");
    expect(rows[0]?.score).toBeCloseTo((2 / 3 + 2 / 3) / 2);
    expect(rows.at(-1)?.repo.id).toBe("d/small");
  });

  it("gives ties the same percentile and respects the limit", () => {
    const tied = [node("x/one", 10, 5), node("y/two", 10, 5)];
    const rows = rankTopRepos(tied, "score", 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.repo.id).toBe("x/one");
    expect(rows[0]?.score).toBe(0.5);
  });

  it("handles empty and single-node graphs", () => {
    expect(rankTopRepos([], "score")).toEqual([]);
    expect(rankTopRepos([node("z/solo", 1, 0)], "score")[0]?.score).toBe(1);
  });
});
