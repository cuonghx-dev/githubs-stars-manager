// `pnpm sync [--full]`: fetch starred repos into data/raw/stars.json, their
// READMEs into data/raw/readmes/ and their root manifests' package names into
// data/raw/deps.json (FR-1-4, FR-7, FR-11, FR-13). `--full` ignores the README
// and dependency caches. I/O and wiring only; logic lives in scripts/lib/ (plan §1).

import { resolve } from "node:path";
import config from "../config/graph.config.ts";
import { readJsonOr, writeJsonAtomic } from "./lib/fs-atomic.ts";
import { DEPS_FILE_VERSION, syncDeps, type DepsFile } from "./lib/deps.ts";
import { createGh, type GhClient } from "./lib/gh.ts";
import { createLogger, type Logger } from "./lib/log.ts";
import { syncReadmes } from "./lib/readmes.ts";
import {
  STARS_FILE_VERSION,
  buildStarsFile,
  diffStars,
  fetchStarredRepos,
  filterPrivate,
  type StarsFile,
} from "./lib/stars.ts";

export const ROOT = resolve(import.meta.dirname, "..");
export const STARS_PATH = resolve(ROOT, "data/raw/stars.json");
export const READMES_DIR = resolve(ROOT, "data/raw/readmes");
export const DEPS_PATH = resolve(ROOT, "data/raw/deps.json");

export interface SyncDeps {
  gh: GhClient;
  logger: Logger;
  starsPath: string;
  readmesDir: string;
  /** `data/raw/deps.json`; absent/`null` skips dependency manifests (FR-7). */
  depsPath?: string | null;
  includePrivate: boolean;
  readmeConcurrency: number;
  /** Ignore the README cache (`--full`). */
  full: boolean;
  now: () => Date;
}

export async function runSync(deps: SyncDeps): Promise<StarsFile> {
  const step = deps.logger.step("sync");
  await deps.gh.assertAuth();

  const fetched = await fetchStarredRepos(deps.gh, {
    onPage: (n, total) => step.info(`fetched ${n}/${total} stars`),
  });
  const repos = filterPrivate(fetched.repos, deps.includePrivate);

  const stored = await readJsonOr<StarsFile | null>(deps.starsPath, null);
  // A file from another user or schema version is not a usable baseline.
  const previous =
    stored?.version === STARS_FILE_VERSION && stored.user === fetched.user
      ? stored
      : null;

  // Fix the summary order: star counters first, README counters after.
  for (const key of [
    "stars",
    "private",
    "added",
    "removed",
    "changed",
    "renamed",
  ]) {
    step.set(key, 0);
  }
  const withReadmes = await syncReadmes({
    gh: deps.gh,
    dir: deps.readmesDir,
    previous: previous?.repos ?? [],
    next: repos,
    full: deps.full,
    concurrency: deps.readmeConcurrency,
    log: step,
  });

  const file = buildStarsFile({
    user: fetched.user,
    repos: withReadmes,
    now: deps.now().toISOString(),
    previous,
  });
  await writeJsonAtomic(deps.starsPath, file);

  if (deps.depsPath != null) {
    const stored = deps.full
      ? null
      : await readJsonOr<DepsFile | null>(deps.depsPath, null);
    const depsFile = await syncDeps({
      gh: deps.gh,
      repos: file.repos,
      previous: stored?.version === DEPS_FILE_VERSION ? stored : null,
      log: step,
    });
    await writeJsonAtomic(deps.depsPath, depsFile);
  }

  const diff = diffStars(previous?.repos ?? [], file.repos);
  for (const { from, to } of diff.renamed) {
    step.info(`renamed ${from} -> ${to.nameWithOwner}`);
  }
  if (fetched.skipped)
    step.warn(`${fetched.skipped} unresolvable stars skipped`);
  step.set("stars", file.repos.length);
  step.set("private", fetched.repos.length - repos.length);
  step.set("added", diff.added.length);
  step.set("removed", diff.removed.length);
  step.set("changed", diff.changed.length);
  step.set("renamed", diff.renamed.length);
  step.done();
  return file;
}

async function main(): Promise<void> {
  await runSync({
    gh: createGh(),
    logger: createLogger(),
    starsPath: STARS_PATH,
    readmesDir: READMES_DIR,
    depsPath: DEPS_PATH,
    includePrivate: config.includePrivate,
    readmeConcurrency: config.readmeConcurrency,
    full: process.argv.includes("--full"),
    now: () => new Date(),
  });
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
