// README text processing (FR-12, FR-41, FR-28).
//
// - `extractLinks` runs on the RAW markdown, before cleaning, because cleaning
//   removes link targets; mention detection (FR-28) needs them.
// - `cleanReadme` is the single cleaning function shared by the embedding
//   input (FR-5) and the detail-panel excerpt (FR-41). It drops HTML tags,
//   images, badge lines, fenced and indented code, tables and link targets
//   (keeping link text), then collapses whitespace.
// - `excerpt` cuts cleaned text to about `max` characters on a word boundary.
//
// All functions are pure and deterministic: no I/O, no locale dependence.

const URL_RE = /https?:\/\/[^\s<>"'`()[\]{}]+/gi;
const TRAILING_PUNCT_RE = /[.,;:!?*_~'"]+$/;

// Images: `![alt](src)`, `![alt][ref]`, `![ref]`, and linked images
// `[![alt](src)](href)` / `[![alt][ref]][ref]` / `[![ref]][ref]` (the usual
// badge shapes).
const LINKED_IMAGE_RE =
  /\[\s*!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])?\s*\](?:\([^)]*\)|\[[^\]]*\])?/g;
const IMAGE_RE = /!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])?/g;
const HTML_IMG_RE = /<img\b[^>]*>/gi;
const HTML_COMMENT_RE = /<!--[\s\S]*?(?:-->|$)/g;
// Elements whose content is never prose: dropped together with their content.
const HTML_DROP_BLOCK_RE =
  /<(script|style|table|pre|svg|picture)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HTML_TAG_RE = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi;

const FENCE_OPEN_RE = /^\s*(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^\s*(`{3,}|~{3,})\s*$/;
// Fences may sit inside a blockquote (`> ```bash`).
const QUOTE_PREFIX_RE = /^(?:\s*>)+/;
const TABLE_DELIM_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const REF_DEF_RE = /^\s{0,3}\[[^\]]+\]:\s*\S+/;
const HR_RE = /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,}|=+)\s*$/;
// What may remain on a badge line once images and tags are gone.
const SEPARATORS_ONLY_RE = /^[\s|·•,\-–—/]*$/;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, name: string) =>
    name in ENTITIES ? ENTITIES[name]! : `&${name};`,
  );
}

/**
 * Absolute http(s) link targets in raw markdown, in first-seen order without
 * duplicates. Covers inline links, reference definitions, autolinks, bare
 * URLs and HTML `href`s (including inside code blocks, which is where
 * `git clone` lines live). Image sources are not links and are skipped, but
 * the target of a linked image (`[![badge](src)](href)`) is kept.
 */
export function extractLinks(md: string): string[] {
  const text = md
    .replace(/\r\n?/g, "\n")
    .replace(HTML_COMMENT_RE, " ")
    // Keep the `[` `]` so a linked image's `(href)` survives as a link.
    .replace(IMAGE_RE, " ")
    .replace(HTML_IMG_RE, " ");

  const seen = new Set<string>();
  const links: string[] = [];
  for (const match of text.matchAll(URL_RE)) {
    const url = decodeEntities(match[0]).replace(TRAILING_PUNCT_RE, "");
    if (url.length > "https://".length && !seen.has(url)) {
      seen.add(url);
      links.push(url);
    }
  }
  return links;
}

function indentWidth(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

/** A line made only of images (badges, logos) and separators. */
export function isBadgeLine(line: string): boolean {
  if (line.trim() === "") return false;
  const rest = line
    .replace(LINKED_IMAGE_RE, "")
    .replace(IMAGE_RE, "")
    .replace(HTML_IMG_RE, "")
    .replace(HTML_TAG_RE, "");
  return rest !== line && SEPARATORS_ONLY_RE.test(rest);
}

/**
 * Line pass: drops fenced/indented code blocks, GFM tables, reference
 * definitions, badge lines, setext underlines and thematic breaks.
 */
function dropBlocks(lines: string[]): string[] {
  const out: string[] = [];
  let fence: { char: string; len: number } | null = null;
  let prevBlank = true;
  let inList = false;
  let inIndentedCode = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const unquoted = line.replace(QUOTE_PREFIX_RE, "");

    if (fence) {
      const close = unquoted.match(FENCE_CLOSE_RE);
      if (
        close?.[1] &&
        close[1][0] === fence.char &&
        close[1].length >= fence.len
      )
        fence = null;
      continue;
    }
    const open = unquoted.match(FENCE_OPEN_RE);
    if (open?.[1]) {
      fence = { char: open[1][0]!, len: open[1].length };
      prevBlank = false;
      inIndentedCode = false;
      continue;
    }

    const blank = line.trim() === "";
    if (blank) {
      out.push("");
      prevBlank = true;
      continue;
    }

    // Indented code: 4+ columns after a blank line, outside a list.
    if (indentWidth(line) >= 4 && !inList && (prevBlank || inIndentedCode)) {
      inIndentedCode = true;
      prevBlank = false;
      continue;
    }
    inIndentedCode = false;

    if (LIST_ITEM_RE.test(line)) inList = true;
    else if (indentWidth(line) === 0 && prevBlank) inList = false;
    prevBlank = false;

    // GFM table: header row + delimiter row, then every row with a pipe.
    const next = lines[i + 1];
    if (
      line.includes("|") &&
      next !== undefined &&
      next.includes("|") &&
      TABLE_DELIM_RE.test(next)
    ) {
      i += 1;
      while (
        i + 1 < lines.length &&
        lines[i + 1]!.includes("|") &&
        lines[i + 1]!.trim() !== ""
      )
        i += 1;
      continue;
    }

    if (REF_DEF_RE.test(line) || HR_RE.test(line) || isBadgeLine(line))
      continue;
    out.push(line);
  }
  return out;
}

/** Inline pass: images, HTML, links (text kept), URLs, light markdown. */
function stripInline(text: string): string {
  return decodeEntities(
    text
      .replace(LINKED_IMAGE_RE, "")
      .replace(IMAGE_RE, "")
      .replace(HTML_IMG_RE, "")
      .replace(HTML_TAG_RE, "")
      // `[text](target)`, `[text][ref]`, `[text][]` -> text
      .replace(/\[((?:[^[\]]|\[[^\]]*\])*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      .replace(/<https?:\/\/[^>\s]*>/gi, "")
      .replace(URL_RE, "")
      // Emphasis and inline-code markers; the text inside is kept.
      .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, "$2")
      .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, "$1$2")
      .replace(/`+([^`\n]+)`+/g, "$1"),
  );
}

/** Per-line markdown prefixes that carry no meaning in plain text. */
function stripLinePrefixes(line: string): string {
  return line
    .replace(/^\s*(?:>\s?)+/, "")
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/\s+#+\s*$/, "");
}

/**
 * Clean a README for embeddings and the excerpt (FR-12). Paragraph breaks are
 * kept as a single blank line; every other run of whitespace becomes one
 * space. Returns "" for a README with no prose left.
 */
export function cleanReadme(md: string): string {
  const prepared = md
    .replace(/\r\n?/g, "\n")
    .replace(/^\uFEFF/, "")
    .replace(HTML_COMMENT_RE, "")
    .replace(HTML_DROP_BLOCK_RE, "");

  const kept = dropBlocks(prepared.split("\n")).join("\n");
  const lines = stripInline(kept)
    .split("\n")
    .map((line) => stripLinePrefixes(line).replace(/\s+/g, " ").trim())
    .map((line) => (SEPARATORS_ONLY_RE.test(line) ? "" : line));

  // Soft line breaks inside a paragraph become spaces; list items keep
  // their own line.
  const joined: string[] = [];
  for (const line of lines) {
    const prev = joined.at(-1);
    if (prev && line && !LIST_ITEM_RE.test(line)) {
      joined[joined.length - 1] = `${prev} ${line}`;
    } else {
      joined.push(line);
    }
  }
  return joined
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * First `max` characters (code points) of cleaned text, cut on a word
 * boundary when one is reasonably close, with "…" appended when shortened.
 * The result is never longer than `max` code points.
 */
export function excerpt(clean: string, max = 500): string {
  const chars = Array.from(clean);
  if (chars.length <= max) return clean;
  if (max <= 1) return "…".slice(0, max);

  let cut = chars.slice(0, max - 1).join("");
  const boundary = cut.search(/\s\S*$/);
  if (boundary >= Math.floor((max - 1) * 0.6)) cut = cut.slice(0, boundary);
  return `${cut.replace(/[\s.,;:!?\-–—]+$/, "")}…`;
}
