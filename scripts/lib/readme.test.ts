import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanReadme, excerpt, extractLinks, isBadgeLine } from "./readme.ts";

const FIXTURES = join(import.meta.dirname, "../__fixtures__/readmes");
const fixture = (name: string) =>
  readFileSync(join(FIXTURES, `${name}.md`), "utf8");

describe("extractLinks", () => {
  it("collects link targets from the typical fixture, skipping image sources", () => {
    expect(extractLinks(fixture("typical"))).toEqual([
      "https://www.npmjs.com/package/widget",
      "https://github.com/acme/widget/actions",
      "https://react.dev",
      "https://github.com/pmndrs/zustand",
      "https://github.com/acme/widget.git",
      "https://widget.dev/docs",
      "https://github.com/immerjs/immer/tree/main/src#readme",
      "https://github.com/acme",
      "https://widget.dev/guide",
      "https://github.com/pmndrs/jotai",
      "https://img.shields.io/badge/License-MIT-yellow.svg",
      "https://opensource.org/licenses/MIT",
    ]);
  });

  it("reads HTML hrefs with either quote style and ignores relative srcs", () => {
    expect(extractLinks(fixture("html-heavy"))).toEqual([
      "https://github.com/octo/cli",
      "https://octo.dev",
      "https://discord.gg/octo",
    ]);
  });

  it("dedupes, trims trailing punctuation and decodes &amp;", () => {
    const md = [
      "See https://github.com/a/b. Also (https://github.com/a/b)!",
      '<a href="https://x.dev/?a=1&amp;b=2">x</a>',
      "<https://autolink.dev/path>",
    ].join("\n");
    expect(extractLinks(md)).toEqual([
      "https://github.com/a/b",
      "https://x.dev/?a=1&b=2",
      "https://autolink.dev/path",
    ]);
  });

  it("keeps URLs inside code (git clone lines) but not in HTML comments", () => {
    const md =
      "```sh\ngit clone https://github.com/o/r\n```\n<!-- https://hidden.dev -->";
    expect(extractLinks(md)).toEqual(["https://github.com/o/r"]);
  });

  it("ignores relative links, anchors and mailto", () => {
    expect(
      extractLinks("[docs](./docs/a.md) [top](#top) [me](mailto:a@b.c)"),
    ).toEqual([]);
  });
});

describe("isBadgeLine", () => {
  it.each([
    "[![npm](https://img.shields.io/npm/v/x.svg)](https://npm.im/x)",
    "[![a](https://a/a.svg)](https://a) | [![b][b-badge]][b-url]",
    "[![Badge Workflow]][Workflow] ![Badge Language]",
    '<a href="https://x"><img src="https://x/b.svg"></a>',
    "![logo](logo.png)",
  ])("detects %s", (line) => {
    expect(isBadgeLine(line)).toBe(true);
  });

  it.each(["", "Plain text", "Build: [![ci](https://a/b.svg)](https://a)"])(
    "rejects %j",
    (line) => {
      expect(isBadgeLine(line)).toBe(false);
    },
  );
});

describe("cleanReadme", () => {
  it("cleans the typical fixture", () => {
    expect(cleanReadme(fixture("typical"))).toBe(
      [
        "Widget",
        "",
        "Widget is a tiny state manager for React apps, inspired by Zustand and Jotai.",
        "",
        "Install",
        "",
        "Usage",
        "",
        "Create a store with createStore:",
        "",
        "Then read it in components. See for more.",
        "",
        "Note: Widget & friends need React 18 or later.",
        "",
        "- Works with React Native",
        "- Plays well with immer",
        "- nested items stay",
        "",
        "Made with ❤ by Acme. Docs:",
      ].join("\n"),
    );
  });

  it("cleans the HTML-heavy fixture (tags, tables, script, style, long fences)", () => {
    expect(cleanReadme(fixture("html-heavy"))).toBe(
      [
        "The command line that <just works>",
        "",
        "Why another CLI?",
        "",
        "Because the others are slow.",
        "",
        "Octo helps you ship faster.",
      ].join("\n"),
    );
  });

  it("normalises CRLF, tabs and runs of blank lines", () => {
    expect(cleanReadme(fixture("crlf"))).toBe(
      "Title\n\nWindows line endings here.\n\nSecond paragraph.",
    );
  });

  it("returns an empty string when nothing but images and code remain", () => {
    expect(cleanReadme(fixture("empty"))).toBe("");
    expect(cleanReadme("")).toBe("");
  });

  it("drops link targets and keeps link text, including nested brackets", () => {
    expect(
      cleanReadme(
        "Use [the [beta] API](https://x.dev) or [ref link][r] and [short][].\n\n[r]: https://r.dev",
      ),
    ).toBe("Use the [beta] API or ref link and short.");
  });

  it("drops fenced code inside blockquotes and list items", () => {
    const md = [
      "> Install it:",
      ">",
      "> ```bash",
      "> npm i secret-command",
      "> ```",
      "",
      "- Step one:",
      "  ```",
      "  hidden-step",
      "  ```",
      "- Step two",
    ].join("\n");
    const clean = cleanReadme(md);
    expect(clean).not.toMatch(/secret-command|hidden-step|```/);
    expect(clean).toBe("Install it:\n\n- Step one:\n- Step two");
  });

  it("treats 4-space indentation as code only outside lists and after a blank line", () => {
    const md = [
      "Intro paragraph",
      "    continues lazily",
      "",
      "    code_line()",
      "",
      "1. item",
      "",
      "    item body paragraph",
    ].join("\n");
    expect(cleanReadme(md)).toBe(
      "Intro paragraph continues lazily\n\n1. item\n\nitem body paragraph",
    );
  });

  it("drops GFM tables without leading pipes but keeps lone pipes in prose", () => {
    const md = "a | b\n--- | ---\n1 | 2\n\nUse a | b in shells.";
    expect(cleanReadme(md)).toBe("Use a | b in shells.");
  });

  it("is deterministic", () => {
    const md = fixture("typical");
    expect(cleanReadme(md)).toBe(cleanReadme(md));
  });
});

describe("excerpt", () => {
  it("returns short text unchanged", () => {
    expect(excerpt("short text", 500)).toBe("short text");
  });

  it("cuts on a word boundary and appends an ellipsis", () => {
    const text = "alpha beta gamma delta epsilon";
    const out = excerpt(text, 20);
    expect(out).toBe("alpha beta gamma…");
    expect(Array.from(out).length).toBeLessThanOrEqual(20);
  });

  it("hard-cuts a single long word", () => {
    expect(excerpt("x".repeat(30), 10)).toBe(`${"x".repeat(9)}…`);
  });

  it("never splits a surrogate pair", () => {
    const out = excerpt("😀".repeat(20), 5);
    expect(out).toBe("😀😀😀😀…");
  });

  it("defaults to 500 characters", () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const out = excerpt(words);
    expect(Array.from(out).length).toBeLessThanOrEqual(500);
    expect(out.endsWith("…")).toBe(true);
    expect(words.startsWith(out.slice(0, -1))).toBe(true);
  });

  it("works on the cleaned typical fixture", () => {
    expect(excerpt(cleanReadme(fixture("typical")), 60)).toBe(
      "Widget\n\nWidget is a tiny state manager for React apps…",
    );
  });
});
