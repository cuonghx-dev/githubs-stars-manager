// Dependency resolution between starred repos (FR-7).
//
// Source: the manifest fallback (spike S2 was skipped, so GitHub's
// `dependencyGraphManifests` is not used). Root manifests are read with
// batched GraphQL `object(expression: "HEAD:<file>")` queries, about 25 repos
// per query, addressed by node id so renames do not matter:
//
//   package.json, Cargo.toml, go.mod, pyproject.toml
//
// `data/raw/deps.json` caches the *package names* each repo declares, keyed by
// `githubId` and invalidated when `pushedAt` changes. Matching those names
// against the current star set happens in `build-graph` (`resolveDependencies`),
// so starring or unstarring a repo never needs a refetch. No package registry
// is ever called (NFR-5).
//
// Match rules (FR-7): a package matches a starred repo when its name equals the
// repo name, case-insensitive (an npm scoped package `@owner/repo` matches only
// that exact starred repo; Python names are compared PEP 503-normalised). Go modules match when
// the module path is `github.com/<owner>/<repo>[/...]`. A name shared by more
// than one starred repo is ambiguous and skipped. Only starred repos count.

import type { GhClient } from "./gh.ts";
import type { RawRepo } from "./stars.ts";

export const DEPS_FILE_VERSION = 1;
/** Repos per GraphQL query (plan T4.3). */
export const DEPS_BATCH_SIZE = 25;

export interface ManifestPackages {
  npm: string[];
  cargo: string[];
  go: string[];
  python: string[];
}

export interface DepsEntry {
  /** `pushedAt` the manifests were read at; a change invalidates the entry. */
  pushedAt: string | null;
  packages: ManifestPackages;
}

export interface DepsFile {
  version: typeof DEPS_FILE_VERSION;
  /** Keyed by `githubId` (stable across renames, FR-4). */
  repos: Record<string, DepsEntry>;
}

const MANIFESTS = {
  npm: "package.json",
  cargo: "Cargo.toml",
  go: "go.mod",
  python: "pyproject.toml",
} as const;
type Ecosystem = keyof typeof MANIFESTS;
const ECOSYSTEMS = Object.keys(MANIFESTS) as Ecosystem[];

const uniqSorted = (xs: Iterable<string>) =>
  [...new Set([...xs].filter((x) => x !== ""))].sort();

// ---------------------------------------------------------------- parsers

/** Dependency names from every dependency map in `package.json`. */
export function parsePackageJson(text: string): string[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof json !== "object" || json === null) return [];
  const out: string[] = [];
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const map = (json as Record<string, unknown>)[field];
    if (typeof map === "object" && map !== null && !Array.isArray(map)) {
      out.push(...Object.keys(map));
    }
  }
  return uniqSorted(out);
}

/** Strip a TOML `#` comment that is not inside a string (good enough here). */
function stripTomlComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#") return line.slice(0, i);
  }
  return line;
}

const TOML_KEY = /^\s*("([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))\s*=/;

function tomlKey(line: string): string | undefined {
  const m = TOML_KEY.exec(line);
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
}

/**
 * Crate names from `[dependencies]`, `[dev-dependencies]`,
 * `[build-dependencies]`, `[workspace.dependencies]` and their
 * `[target.*.…]` variants, plus `[dependencies.<name>]` tables. A renamed
 * dependency (`alias = { package = "real" }`) counts as `real`.
 */
export function parseCargoToml(text: string): string[] {
  const out: string[] = [];
  let inDeps = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripTomlComment(raw).trim();
    if (line === "") continue;
    const header = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (header) {
      const parts = header[1]!
        .split(".")
        .map((p) => p.trim().replace(/^"|"$/g, ""));
      const idx = parts.findIndex((p) =>
        /^(dev-|build-)?dependencies$/.test(p),
      );
      inDeps = idx !== -1 && idx === parts.length - 1;
      // `[dependencies.serde]` names the crate in the header.
      if (idx !== -1 && idx === parts.length - 2) out.push(parts[idx + 1]!);
      continue;
    }
    if (!inDeps) continue;
    const key = tomlKey(line);
    if (key === undefined) continue;
    const pkg = /\bpackage\s*=\s*["']([^"']+)["']/.exec(line);
    out.push(pkg ? pkg[1]! : key);
  }
  return uniqSorted(out);
}

/** Module paths from `require` lines and blocks of `go.mod`. */
export function parseGoMod(text: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (line === "") continue;
    if (inBlock) {
      if (line === ")") inBlock = false;
      else out.push(line.split(/\s+/)[0]!);
      continue;
    }
    if (/^require\s*\($/.test(line)) {
      inBlock = true;
      continue;
    }
    const single = /^require\s+(\S+)/.exec(line);
    if (single) out.push(single[1]!);
  }
  return uniqSorted(out);
}

/** Package name from a PEP 508 requirement string (`requests[socks]>=2`). */
function pep508Name(spec: string): string | undefined {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec);
  return m?.[1];
}

/**
 * Python package names from `pyproject.toml`: PEP 621
 * `[project] dependencies` and `[project.optional-dependencies]`, plus Poetry
 * `[tool.poetry.dependencies]` / `[tool.poetry.*dependencies]` /
 * `[tool.poetry.group.*.dependencies]` keys (`python` itself is dropped).
 */
export function parsePyproject(text: string): string[] {
  const out: string[] = [];
  let section = "";
  // Inside a multi-line array whose strings are requirement specs.
  let inSpecArray = false;
  const collectStrings = (s: string) => {
    for (const m of s.matchAll(/"([^"]*)"|'([^']*)'/g)) {
      const name = pep508Name(m[1] ?? m[2] ?? "");
      if (name) out.push(name);
    }
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = stripTomlComment(raw).trim();
    if (line === "") continue;
    if (inSpecArray) {
      collectStrings(line);
      if (line.includes("]")) inSpecArray = false;
      continue;
    }
    const header = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (header) {
      section = header[1]!.trim();
      continue;
    }
    const key = tomlKey(line);
    if (key === undefined) continue;
    const value = line.slice(line.indexOf("=") + 1).trim();
    const specArray =
      (section === "project" &&
        (key === "dependencies" || key === "optional-dependencies")) ||
      section === "project.optional-dependencies" ||
      section === "dependency-groups";
    if (specArray && value.startsWith("[")) {
      collectStrings(value);
      if (!value.includes("]")) inSpecArray = true;
      continue;
    }
    const poetryDeps =
      /^tool\.poetry\.((dev-)?dependencies|group\.[^.]+\.dependencies)$/.test(
        section,
      );
    if (poetryDeps && key.toLowerCase() !== "python") out.push(key);
  }
  return uniqSorted(out);
}

export function parseManifests(
  texts: Partial<Record<Ecosystem, string | null>>,
): ManifestPackages {
  return {
    npm: texts.npm ? parsePackageJson(texts.npm) : [],
    cargo: texts.cargo ? parseCargoToml(texts.cargo) : [],
    go: texts.go ? parseGoMod(texts.go) : [],
    python: texts.python ? parsePyproject(texts.python) : [],
  };
}

// ---------------------------------------------------------------- fetching

interface BlobField {
  text?: string | null;
}
type RepoManifests = Partial<Record<Ecosystem, BlobField | null>> | null;

/** One aliased GraphQL query for a batch of repos, addressed by node id. */
export function manifestQuery(githubIds: readonly string[]): string {
  const fields = ECOSYSTEMS.map(
    (eco) =>
      `${eco}: object(expression: ${JSON.stringify(`HEAD:${MANIFESTS[eco]}`)}) { ... on Blob { text } }`,
  ).join(" ");
  const body = githubIds
    .map(
      (id, i) =>
        `r${i}: node(id: ${JSON.stringify(id)}) { ... on Repository { ${fields} } }`,
    )
    .join("\n  ");
  return `query {\n  ${body}\n}`;
}

export interface SyncDepsOptions {
  gh: GhClient;
  repos: readonly RawRepo[];
  previous: DepsFile | null;
  batchSize?: number;
  log: {
    count(name: string, n?: number): void;
    info(message: string): void;
    warn(message: string): void;
  };
}

/**
 * Refresh the manifest cache for `repos`: entries whose `pushedAt` is
 * unchanged are reused, the rest are fetched in batches. Entries of repos no
 * longer starred are dropped. A failed batch is logged and left uncached so
 * the next run retries it.
 */
export async function syncDeps(opts: SyncDepsOptions): Promise<DepsFile> {
  const prev =
    opts.previous?.version === DEPS_FILE_VERSION ? opts.previous.repos : {};
  const out: Record<string, DepsEntry> = {};
  const todo: RawRepo[] = [];
  for (const repo of opts.repos) {
    const cached = prev[repo.githubId];
    if (cached && cached.pushedAt === repo.pushedAt) {
      out[repo.githubId] = cached;
      opts.log.count("depsCached");
    } else {
      todo.push(repo);
    }
  }

  const size = opts.batchSize ?? DEPS_BATCH_SIZE;
  for (let start = 0; start < todo.length; start += size) {
    const batch = todo.slice(start, start + size);
    let data: Record<string, RepoManifests>;
    try {
      data = await opts.gh.graphql<Record<string, RepoManifests>>(
        manifestQuery(batch.map((r) => r.githubId)),
      );
    } catch (error) {
      opts.log.warn(
        `deps batch ${start / size + 1} failed (${error instanceof Error ? error.message : String(error)}); will retry next sync`,
      );
      opts.log.count("depsFailed", batch.length);
      continue;
    }
    batch.forEach((repo, i) => {
      const node = data[`r${i}`];
      const texts: Partial<Record<Ecosystem, string | null>> = {};
      for (const eco of ECOSYSTEMS) texts[eco] = node?.[eco]?.text ?? null;
      out[repo.githubId] = {
        pushedAt: repo.pushedAt,
        packages: parseManifests(texts),
      };
    });
    opts.log.count("depsFetched", batch.length);
    opts.log.info(
      `deps ${Math.min(start + size, todo.length)}/${todo.length} fetched`,
    );
  }

  // Stable key order so the cache file diffs cleanly.
  const sorted: Record<string, DepsEntry> = {};
  for (const id of Object.keys(out).sort()) sorted[id] = out[id]!;
  return { version: DEPS_FILE_VERSION, repos: sorted };
}

// ---------------------------------------------------------------- matching

const pep503 = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");

/**
 * Directed dependencies between starred repos: `nameWithOwner` → sorted list
 * of starred repos it depends on (FR-7). Self-dependencies, ambiguous names
 * and repos without a cache entry are skipped.
 */
export function resolveDependencies(
  repos: readonly Pick<RawRepo, "githubId" | "nameWithOwner">[],
  deps: DepsFile,
): Map<string, string[]> {
  // Repo name → starred repos with that name (lowercased / PEP 503).
  const byName = new Map<string, string[]>();
  const byPyName = new Map<string, string[]>();
  const byPath = new Map<string, string>();
  const add = (map: Map<string, string[]>, key: string, id: string) => {
    const list = map.get(key);
    if (list) list.push(id);
    else map.set(key, [id]);
  };
  for (const repo of repos) {
    const name = repo.nameWithOwner.slice(repo.nameWithOwner.indexOf("/") + 1);
    add(byName, name.toLowerCase(), repo.nameWithOwner);
    add(byPyName, pep503(name), repo.nameWithOwner);
    byPath.set(repo.nameWithOwner.toLowerCase(), repo.nameWithOwner);
  }
  const unique = (list: string[] | undefined) =>
    list?.length === 1 ? list[0] : undefined;

  const out = new Map<string, string[]>();
  for (const repo of repos) {
    const entry = deps.repos[repo.githubId];
    if (!entry) continue;
    const found = new Set<string>();
    const { npm, cargo, go, python } = entry.packages;
    for (const pkg of npm) {
      const lower = pkg.toLowerCase();
      // `@owner/repo` names the repo exactly; any other scoped name is too
      // generic (`@types/bun`, `@x/core`) to match on its bare part.
      const hit = lower.startsWith("@")
        ? byPath.get(lower.slice(1))
        : unique(byName.get(lower));
      if (hit) found.add(hit);
    }
    for (const pkg of cargo) {
      const hit = unique(byName.get(pkg.toLowerCase()));
      if (hit) found.add(hit);
    }
    for (const mod of go) {
      const m = /^github\.com\/([^/]+)\/([^/]+)/i.exec(mod);
      const hit = m ? byPath.get(`${m[1]}/${m[2]}`.toLowerCase()) : undefined;
      if (hit) found.add(hit);
    }
    for (const pkg of python) {
      const hit = unique(byPyName.get(pep503(pkg)));
      if (hit) found.add(hit);
    }
    found.delete(repo.nameWithOwner);
    if (found.size > 0) out.set(repo.nameWithOwner, [...found].sort());
  }
  return out;
}
