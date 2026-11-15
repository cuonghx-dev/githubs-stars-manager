import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DetailPanel } from "@/features/detail/DetailPanel";
import type { Cluster, RepoNode } from "@/lib/graph-schema";

const clusters: Cluster[] = [
  { id: 0, label: "react · ui · hooks", color: "#4f7cff", size: 2 },
];

const repo: RepoNode = {
  id: "facebook/react",
  githubId: "R_1",
  name: "react",
  owner: "facebook",
  url: "https://github.com/facebook/react",
  homepage: "react.dev",
  description: "The library for web and native user interfaces.",
  readmeExcerpt: "React is a JavaScript library for building user interfaces.",
  language: "JavaScript",
  languages: ["JavaScript"],
  topics: ["react", "ui"],
  stars: 230000,
  forks: 47000,
  license: "MIT",
  isArchived: true,
  isFork: false,
  pushedAt: "2026-11-14T09:30:00Z",
  createdAt: "2013-05-24T16:15:54Z",
  starredAt: "2020-01-02T03:04:05Z",
  cluster: 0,
  x: 0,
  y: 0,
  metrics: { degree: 1, weightedDegree: 0.8 },
};

// Server render: zustand serves its initial state here, so the chip's
// pressed state is covered by the `isOnlyCluster` unit tests instead.

describe("DetailPanel", () => {
  it("renders metadata, links, excerpt and cluster chip", () => {
    const html = renderToStaticMarkup(
      <DetailPanel repo={repo} clusters={clusters} />,
    );
    for (const text of [
      "facebook/",
      "The library for web and native user interfaces.",
      "JavaScript",
      "230K",
      "47K",
      "Nov 14, 2026",
      "Jan 2, 2020",
      "MIT",
      "Archived",
      "react · ui · hooks",
      "React is a JavaScript library",
      'href="https://github.com/facebook/react"',
      'href="https://react.dev/"',
      'aria-pressed="false"',
    ]) {
      expect(html).toContain(text);
    }
  });

  it("omits optional fields", () => {
    const html = renderToStaticMarkup(
      <DetailPanel
        repo={{
          ...repo,
          homepage: "javascript:alert(1)",
          description: undefined,
          readmeExcerpt: undefined,
          license: undefined,
          language: undefined,
          isArchived: false,
          topics: [],
        }}
        clusters={clusters}
      />,
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("README");
    expect(html).not.toContain("License");
    expect(html).not.toContain("Archived");
    expect(html).not.toContain("Topics");
  });
});
