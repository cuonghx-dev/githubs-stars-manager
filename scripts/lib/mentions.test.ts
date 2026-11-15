import { describe, expect, it } from "vitest";
import {
  buildMentionIndex,
  findMentions,
  normalizeGithubRepoUrl,
  normalizeHomepage,
  type MentionRepo,
} from "./mentions.ts";

describe("normalizeGithubRepoUrl", () => {
  it.each([
    ["https://github.com/pmndrs/zustand", "pmndrs/zustand"],
    ["http://github.com/pmndrs/zustand", "pmndrs/zustand"],
    ["https://www.github.com/pmndrs/zustand", "pmndrs/zustand"],
    ["https://GitHub.com/PMNDRS/Zustand", "pmndrs/zustand"],
    ["https://github.com/acme/widget.git", "acme/widget"],
    ["https://github.com/acme/widget.GIT", "acme/widget"],
    ["https://github.com/acme/widget/", "acme/widget"],
    ["https://github.com/immerjs/immer/tree/main/src#readme", "immerjs/immer"],
    ["https://github.com/acme/widget/blob/main/README.md", "acme/widget"],
    ["https://github.com/acme/widget#install", "acme/widget"],
    ["https://github.com/acme/widget?tab=readme-ov-file", "acme/widget"],
    ["https://github.com/acme/widget/actions", "acme/widget"],
    ["https://github.com/acme/next.js", "acme/next.js"],
    ["https://github.com/acme/dot.git.git", "acme/dot.git"],
    ["github.com/acme/widget", "acme/widget"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeGithubRepoUrl(input)).toBe(expected);
  });

  it.each([
    "https://github.com/acme",
    "https://github.com/acme/",
    "https://github.com",
    "https://gist.github.com/acme/abc123",
    "https://acme.github.io/widget",
    "https://gitlab.com/acme/widget",
    "https://notgithub.com/acme/widget",
    "https://github.com/acme/.git",
    "https://github.com/-bad/widget",
    "ftp://github.com/acme/widget",
    "mailto:me@github.com",
    "",
    "not a url",
  ])("rejects %j", (input) => {
    expect(normalizeGithubRepoUrl(input)).toBeNull();
  });
});

describe("normalizeHomepage", () => {
  it.each([
    ["https://widget.dev", "widget.dev"],
    ["http://widget.dev/", "widget.dev"],
    ["https://www.widget.dev", "widget.dev"],
    ["https://WWW.Widget.DEV/", "widget.dev"],
    ["widget.dev", "widget.dev"],
    ["https://widget.dev/docs/", "widget.dev/docs"],
    ["https://widget.dev/docs//", "widget.dev/docs"],
    ["https://widget.dev/Docs", "widget.dev/Docs"],
    ["https://widget.dev/#intro", "widget.dev"],
    ["https://widget.dev/?utm_source=github", "widget.dev"],
    ["https://widget.dev:443/", "widget.dev"],
    ["http://localhost:8080/app/", "localhost:8080/app"],
    ["https://acme.github.io/widget/", "acme.github.io/widget"],
    ["  https://widget.dev  ", "widget.dev"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeHomepage(input)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "   ",
    "https://github.com/acme/widget",
    "https://www.github.com/acme/widget",
    "https://github.com/acme",
    "ftp://widget.dev",
    "http://",
  ])("rejects %j", (input) => {
    expect(normalizeHomepage(input)).toBeNull();
  });
});

const REPOS: MentionRepo[] = [
  { nameWithOwner: "acme/widget", homepageUrl: "https://widget.dev" },
  {
    nameWithOwner: "pmndrs/zustand",
    homepageUrl: "https://zustand-demo.pmnd.rs/",
  },
  {
    nameWithOwner: "immerjs/immer",
    homepageUrl: "https://immerjs.github.io/immer/",
  },
  {
    nameWithOwner: "pmndrs/Jotai",
    homepageUrl: "https://github.com/pmndrs/jotai",
  },
  { nameWithOwner: "facebook/react", homepageUrl: "https://react.dev" },
  { nameWithOwner: "facebook/react-native", homepageUrl: null },
  { nameWithOwner: "acme/widget-cli", homepageUrl: "https://www.widget.dev/" },
];

describe("buildMentionIndex", () => {
  const index = buildMentionIndex(REPOS);

  it("indexes every repo by lowercase owner/repo", () => {
    expect(index.byRepo.get("pmndrs/jotai")).toBe("pmndrs/Jotai");
    expect(index.byRepo.size).toBe(REPOS.length);
  });

  it("indexes normalised homepages, skipping empty and github.com ones", () => {
    expect([...index.byHomepage.keys()].sort()).toEqual([
      "immerjs.github.io/immer",
      "react.dev",
      "widget.dev",
      "zustand-demo.pmnd.rs",
    ]);
  });

  it("keeps every repo that shares a homepage, sorted", () => {
    expect(index.byHomepage.get("widget.dev")).toEqual([
      "acme/widget",
      "acme/widget-cli",
    ]);
  });
});

describe("findMentions", () => {
  const index = buildMentionIndex(REPOS);

  it("matches GitHub repo links in any supported shape", () => {
    expect(
      findMentions(index, "acme/widget", [
        "https://github.com/pmndrs/zustand",
        "https://github.com/acme/widget.git",
        "https://github.com/immerjs/immer/tree/main/src#readme",
        "https://github.com/PMNDRS/JOTAI/blob/main/readme.md",
        "https://github.com/acme",
        "https://github.com/unknown/repo",
      ]),
    ).toEqual(["immerjs/immer", "pmndrs/Jotai", "pmndrs/zustand"]);
  });

  it("matches homepage links after normalisation", () => {
    expect(
      findMentions(index, "pmndrs/zustand", [
        "http://www.react.dev/",
        "https://immerjs.github.io/immer#top",
      ]),
    ).toEqual(["facebook/react", "immerjs/immer"]);
  });

  it("does not match a deeper page of a homepage", () => {
    expect(
      findMentions(index, "pmndrs/zustand", ["https://react.dev/learn"]),
    ).toEqual([]);
  });

  it("ignores self-links by repo URL and by own homepage", () => {
    expect(
      findMentions(index, "facebook/react", [
        "https://github.com/facebook/react",
        "https://github.com/Facebook/React/issues",
        "https://react.dev",
      ]),
    ).toEqual([]);
  });

  it("still reports a sibling that shares the source's homepage", () => {
    expect(findMentions(index, "acme/widget", ["https://widget.dev/"])).toEqual(
      ["acme/widget-cli"],
    );
  });

  it("does not confuse prefix-sharing repo names", () => {
    expect(
      findMentions(index, "acme/widget", [
        "https://github.com/facebook/react-native",
      ]),
    ).toEqual(["facebook/react-native"]);
  });

  it("dedupes repeated mentions and ignores junk links", () => {
    expect(
      findMentions(index, "acme/widget", [
        "https://github.com/pmndrs/zustand",
        "https://github.com/pmndrs/zustand#readme",
        "https://zustand-demo.pmnd.rs",
        "https://img.shields.io/badge/License-MIT-yellow.svg",
        "not a url",
        "",
      ]),
    ).toEqual(["pmndrs/zustand"]);
  });

  it("returns [] for no links or an empty index", () => {
    expect(findMentions(index, "acme/widget", [])).toEqual([]);
    expect(
      findMentions(buildMentionIndex([]), "acme/widget", [
        "https://github.com/pmndrs/zustand",
      ]),
    ).toEqual([]);
  });
});
