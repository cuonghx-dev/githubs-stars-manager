// Mention detection (FR-28).
//
// A README mentions repo B when one of its links (from `extractLinks`, run on
// the raw markdown before cleaning) points at B's GitHub page or at B's
// homepage. Both sides are normalised to a comparable key first:
//
// - GitHub repo links → lowercase `owner/repo`, ignoring scheme, `www.`, a
//   trailing `.git`, any sub-path (`/tree/…`, `/blob/…`, `/issues`, …), query
//   and fragment.
// - Homepages → lowercase host without `www.` plus the path without trailing
//   `/`; scheme, port defaults, query and fragment are ignored. Homepages on
//   github.com are skipped: they are just the repo URL (already covered by the
//   repo key) or an owner page that would match unrelated links.
//
// Self-links are ignored. All functions are pure and deterministic.

/** The repo fields mention detection needs (a subset of `RawRepo`). */
export interface MentionRepo {
  nameWithOwner: string;
  homepageUrl: string | null;
}

export interface MentionIndex {
  /** Lowercase `owner/repo` → canonical `nameWithOwner`. */
  byRepo: Map<string, string>;
  /** Normalised homepage → canonical `nameWithOwner`s that use it (sorted). */
  byHomepage: Map<string, string[]>;
}

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
// GitHub user/org names: alphanumerics and single hyphens, max 39 chars.
const OWNER_RE = /^[a-z0-9](?:[a-z0-9-]{0,38})$/i;
// Repo names: alphanumerics, `.`, `_`, `-`; `.` and `..` are not repos.
const REPO_RE = /^[a-z0-9._-]+$/i;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  // Homepages are sometimes stored without a scheme (`example.com`).
  const withScheme = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "") return null;
  return url;
}

/**
 * Normalise a link to a GitHub repo as lowercase `owner/repo`, or `null` when
 * the URL is not a GitHub repo link (other host, owner page, bad names).
 */
export function normalizeGithubRepoUrl(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url || !GITHUB_HOSTS.has(url.hostname.toLowerCase())) return null;
  const [owner, repoSegment] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repoSegment) return null;
  const repo = repoSegment.replace(/\.git$/i, "");
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) return null;
  if (repo === "." || repo === "..") return null;
  return `${owner}/${repo}`.toLowerCase();
}

/**
 * Normalise a homepage URL to `host/path` (lowercase host without `www.`, no
 * trailing `/`), or `null` when it is empty, not http(s), or on github.com.
 */
export function normalizeHomepage(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const url = parseUrl(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (GITHUB_HOSTS.has(host) || GITHUB_HOSTS.has(`www.${host}`)) return null;
  const port = url.port ? `:${url.port}` : "";
  const path = url.pathname.replace(/\/+$/, "");
  return `${host}${port}${path}`;
}

export function buildMentionIndex(repos: readonly MentionRepo[]): MentionIndex {
  const byRepo = new Map<string, string>();
  const byHomepage = new Map<string, string[]>();
  for (const repo of repos) {
    byRepo.set(repo.nameWithOwner.toLowerCase(), repo.nameWithOwner);
    const home = normalizeHomepage(repo.homepageUrl);
    if (home === null) continue;
    const owners = byHomepage.get(home);
    if (owners) owners.push(repo.nameWithOwner);
    else byHomepage.set(home, [repo.nameWithOwner]);
  }
  for (const owners of byHomepage.values()) owners.sort();
  return { byRepo, byHomepage };
}

/**
 * Repos (canonical `nameWithOwner`, sorted, unique) that `source`'s README
 * links mention. Links to `source` itself, or to its own homepage, are ignored.
 */
export function findMentions(
  index: MentionIndex,
  source: string,
  links: readonly string[],
): string[] {
  const self = source.toLowerCase();
  const found = new Set<string>();
  for (const link of links) {
    const repoKey = normalizeGithubRepoUrl(link);
    if (repoKey !== null) {
      const target = index.byRepo.get(repoKey);
      if (target !== undefined) found.add(target);
      continue;
    }
    const home = normalizeHomepage(link);
    if (home === null) continue;
    for (const target of index.byHomepage.get(home) ?? []) found.add(target);
  }
  return [...found].filter((name) => name.toLowerCase() !== self).sort();
}
