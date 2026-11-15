// `pnpm enrich:todo`: write data/enrich-todo.json listing starred repos that
// have no entry in data/enrichment.json yet (FR-70). Each item carries the
// repo metadata and the repo-relative path to its raw README so Claude Code can
// enrich it in batches (docs/enrichment.md, FR-71).
//
// Repos hidden in data/manual.yaml are skipped (they never reach the graph).
// Enrichment keys match case-insensitively; their content is not validated
// here (build-graph does that, FR-72). Output is sorted by repo id.

import { access, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import config from "../config/graph.config.ts";
import { MANUAL_PATH } from "./build-graph.ts";
import { readJsonOr, writeJsonAtomic } from "./lib/fs-atomic.ts";
import { createLogger, type Logger } from "./lib/log.ts";
import { parseManual } from "./lib/manual.ts";
import { readmePath } from "./lib/readmes.ts";
import {
  STARS_FILE_VERSION,
  filterPrivate,
  type StarsFile,
} from "./lib/stars.ts";
import { READMES_DIR, ROOT, STARS_PATH } from "./sync.ts";

export const ENRICHMENT_PATH = resolve(ROOT, "data/enrichment.json");
export const ENRICH_TODO_PATH = resolve(ROOT, "data/enrich-todo.json");
export const ENRICH_TODO_VERSION = 1;

export interface EnrichTodoItem {
  /** `owner/repo`; the key to use in data/enrichment.json. */
  id: string;
  description: string | null;
  url: string;
  primaryLanguage: string | null;
  topics: string[];
  /** Repo-relative path to the raw README, or null when there is none. */
  readme: string | null;
}

export interface EnrichTodoFile {
  version: typeof ENRICH_TODO_VERSION;
  generatedAt: string;
  /** Visible, non-hidden starred repos. */
  total: number;
  /** Of those, how many already have an enrichment entry. */
  enriched: number;
  todo: EnrichTodoItem[];
}

export interface EnrichTodoDeps {
  logger: Logger;
  root: string;
  starsPath: string;
  readmesDir: string;
  enrichmentPath: string;
  manualPath?: string | null;
  todoPath: string;
  includePrivate: boolean;
  now: () => Date;
}

export async function runEnrichTodo(
  deps: EnrichTodoDeps,
): Promise<EnrichTodoFile> {
  const step = deps.logger.step("enrich:todo");
  const stars = await readJsonOr<StarsFile | null>(deps.starsPath, null);
  if (stars === null) {
    throw new Error(`${deps.starsPath} not found; run \`pnpm sync\` first`);
  }
  if (stars.version !== STARS_FILE_VERSION) {
    throw new Error(
      `${deps.starsPath} has version ${String(stars.version)}, expected ${STARS_FILE_VERSION}; run \`pnpm sync\``,
    );
  }
  const visible = filterPrivate(stars.repos, deps.includePrivate);

  const hidden = await readHidden(
    deps.manualPath,
    visible.map((r) => r.nameWithOwner),
  );
  const repos = visible.filter((r) => !hidden.has(r.nameWithOwner));

  const enrichment = await readJsonOr<unknown>(deps.enrichmentPath, {});
  if (
    enrichment === null ||
    typeof enrichment !== "object" ||
    Array.isArray(enrichment)
  ) {
    throw new Error(
      `${deps.enrichmentPath} must be a JSON object keyed by "owner/repo"`,
    );
  }
  const done = new Set(Object.keys(enrichment).map((k) => k.toLowerCase()));

  const todo: EnrichTodoItem[] = [];
  for (const repo of repos) {
    if (done.has(repo.nameWithOwner.toLowerCase())) continue;
    let readme: string | null = null;
    if (repo.readme?.status === "ok") {
      const path = readmePath(deps.readmesDir, repo.nameWithOwner);
      if (await exists(path)) {
        readme = relative(deps.root, path).split("\\").join("/");
      } else {
        step.count("readmeMissingFile");
      }
    }
    if (readme === null) step.count("noReadme");
    todo.push({
      id: repo.nameWithOwner,
      description: repo.description,
      url: repo.url,
      primaryLanguage: repo.primaryLanguage,
      topics: repo.topics,
      readme,
    });
  }
  todo.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const file: EnrichTodoFile = {
    version: ENRICH_TODO_VERSION,
    generatedAt: deps.now().toISOString(),
    total: repos.length,
    enriched: repos.length - todo.length,
    todo,
  };
  await writeJsonAtomic(deps.todoPath, file);

  step.set("total", file.total);
  step.set("enriched", file.enriched);
  step.set("todo", todo.length);
  step.set("hidden", visible.length - repos.length);
  step.done();
  return file;
}

async function readHidden(
  path: string | null | undefined,
  knownIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (path == null) return new Set();
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw error;
  }
  return parseManual(text, knownIds).hide;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  await runEnrichTodo({
    logger: createLogger(),
    root: ROOT,
    starsPath: STARS_PATH,
    readmesDir: READMES_DIR,
    enrichmentPath: ENRICHMENT_PATH,
    manualPath: MANUAL_PATH,
    todoPath: ENRICH_TODO_PATH,
    includePrivate: config.includePrivate,
    now: () => new Date(),
  });
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
