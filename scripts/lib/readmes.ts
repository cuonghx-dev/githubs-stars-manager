// README fetch and incremental cache under data/raw/readmes/ (FR-3, FR-4).
//
// The cache is keyed by GitHub node id (`githubId`): a README is re-fetched
// only when `pushedAt` moved since it was fetched; a renamed repo has its file
// moved instead of re-fetched; removed stars lose their file. `full` ignores
// the cache. `gh` is injected, so tests never touch the network (NFR-10).

import { access, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import pLimit from "p-limit";
import { writeTextAtomic } from "./fs-atomic.ts";
import { GhError, type GhClient } from "./gh.ts";
import type { RawRepo, ReadmeState } from "./stars.ts";

export const RAW_ACCEPT = "application/vnd.github.raw";

/** `owner/repo` -> `<dir>/owner__repo.md` (FR-3). */
export function readmePath(dir: string, nameWithOwner: string): string {
  return join(dir, `${nameWithOwner.replace("/", "__")}.md`);
}

/** Value stored in `readme.fetchedForPushedAt`; never-pushed repos use "". */
export function pushedKey(repo: Pick<RawRepo, "pushedAt">): string {
  return repo.pushedAt ?? "";
}

export type ReadmeResult =
  { status: "ok"; text: string } | { status: "missing" };

/** Fetch one README as raw text; HTTP 404 means "no README" (FR-3). */
export async function fetchReadme(
  gh: Pick<GhClient, "api">,
  nameWithOwner: string,
): Promise<ReadmeResult> {
  try {
    const text = await gh.api(`repos/${nameWithOwner}/readme`, {
      headers: { Accept: RAW_ACCEPT },
    });
    return { status: "ok", text };
  } catch (error) {
    if (error instanceof GhError && error.status === 404) {
      return { status: "missing" };
    }
    throw error;
  }
}

export interface ReadmePlan {
  /** Files of stars that are gone (or now filtered out). */
  deletes: string[];
  /** Same `githubId`, new `nameWithOwner`: move the cached file. */
  moves: { from: string; to: string }[];
  /** Repos whose README must be (re-)fetched. */
  fetch: RawRepo[];
  /** Repos whose cached state is reused, by `githubId`. */
  reuse: Map<string, ReadmeState>;
}

export interface PlanInput {
  dir: string;
  previous: readonly RawRepo[];
  next: readonly RawRepo[];
  full: boolean;
}

/** Decide deletes, moves, fetches and cache hits. Pure. */
export function planReadmes(input: PlanInput): ReadmePlan {
  const { dir, full } = input;
  const before = new Map(input.previous.map((r) => [r.githubId, r]));
  const nextIds = new Set(input.next.map((r) => r.githubId));
  const plan: ReadmePlan = {
    deletes: [],
    moves: [],
    fetch: [],
    reuse: new Map(),
  };

  for (const old of input.previous) {
    if (!nextIds.has(old.githubId) && old.readme?.status === "ok") {
      plan.deletes.push(readmePath(dir, old.nameWithOwner));
    }
  }

  for (const repo of input.next) {
    const old = before.get(repo.githubId);
    const state = old?.readme;
    if (
      old &&
      state?.status === "ok" &&
      old.nameWithOwner !== repo.nameWithOwner
    ) {
      plan.moves.push({
        from: readmePath(dir, old.nameWithOwner),
        to: readmePath(dir, repo.nameWithOwner),
      });
    }
    if (!full && state && state.fetchedForPushedAt === pushedKey(repo)) {
      plan.reuse.set(repo.githubId, state);
    } else {
      plan.fetch.push(repo);
    }
  }
  return plan;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface ReadmeLog {
  info(message: string): void;
  warn(message: string): void;
  count(name: string, n?: number): void;
}

export interface SyncReadmesInput {
  gh: Pick<GhClient, "api">;
  dir: string;
  previous: readonly RawRepo[];
  /** Repos to keep; their `readme` field is ignored and recomputed. */
  next: readonly RawRepo[];
  full: boolean;
  concurrency: number;
  log: ReadmeLog;
}

/**
 * Apply the plan: delete, move, then fetch with bounded concurrency.
 * Returns `next` with each repo's `readme` state set; a repo whose fetch
 * failed keeps its previous state (or none), so the next run retries it.
 */
export async function syncReadmes(input: SyncReadmesInput): Promise<RawRepo[]> {
  const { dir, log } = input;
  const plan = planReadmes(input);
  const states = new Map(plan.reuse);
  const previousState = new Map(
    input.previous.flatMap((r) => (r.readme ? [[r.githubId, r.readme]] : [])),
  );

  for (const path of plan.deletes) {
    await rm(path, { force: true });
    log.count("deleted");
  }

  for (const { from, to } of plan.moves) {
    // An interrupted earlier run may have moved it already.
    if (!(await exists(from))) continue;
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    log.count("moved");
  }

  // A cached "ok" whose file vanished is fetched again.
  const byId = new Map(input.next.map((r) => [r.githubId, r]));
  for (const [id, state] of plan.reuse) {
    const repo = byId.get(id);
    if (
      repo &&
      state.status === "ok" &&
      !(await exists(readmePath(dir, repo.nameWithOwner)))
    ) {
      states.delete(id);
      plan.fetch.push(repo);
    }
  }
  log.count("cached", states.size);

  const limit = pLimit(input.concurrency);
  // Tallied locally so the summary order does not depend on fetch timing.
  const tally = { fetched: 0, missing: 0, failed: 0 };
  let done = 0;
  await Promise.all(
    plan.fetch.map((repo) =>
      limit(async () => {
        const path = readmePath(dir, repo.nameWithOwner);
        try {
          const result = await fetchReadme(input.gh, repo.nameWithOwner);
          if (result.status === "ok") {
            await writeTextAtomic(path, result.text);
            tally.fetched++;
          } else {
            await rm(path, { force: true });
            tally.missing++;
          }
          states.set(repo.githubId, {
            status: result.status,
            fetchedForPushedAt: pushedKey(repo),
          });
        } catch (error) {
          log.warn(
            `README ${repo.nameWithOwner}: ${error instanceof Error ? error.message : String(error)}`,
          );
          tally.failed++;
          const old = previousState.get(repo.githubId);
          if (old) states.set(repo.githubId, old);
        }
        done++;
        if (done % 100 === 0 || done === plan.fetch.length) {
          log.info(`readmes ${done}/${plan.fetch.length}`);
        }
      }),
    ),
  );

  for (const [name, n] of Object.entries(tally)) if (n) log.count(name, n);

  return input.next.map((repo) => {
    const out: RawRepo = { ...repo };
    delete out.readme;
    const state = states.get(repo.githubId);
    if (state) out.readme = state;
    return out;
  });
}
