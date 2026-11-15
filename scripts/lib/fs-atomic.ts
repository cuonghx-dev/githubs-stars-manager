// Atomic file writes (FR-13): write to a temp file in the same directory, then
// rename over the target. An interrupted run leaves either the old file or the
// new one, never a half-written cache.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

function tempPathFor(target: string): string {
  const suffix = `${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  return join(dirname(target), `.${basename(target)}.${suffix}`);
}

export async function writeTextAtomic(
  path: string,
  text: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = tempPathFor(path);
  try {
    await writeFile(tmp, text, "utf8");
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/** Pretty-printed JSON with a trailing newline, written atomically. */
export async function writeJsonAtomic(
  path: string,
  value: unknown,
): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Read and parse a JSON file. Returns `fallback` only when the file does not
 * exist; invalid JSON and other I/O errors are rethrown.
 */
export async function readJsonOr<T>(path: string, fallback: T): Promise<T> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
  return JSON.parse(text) as T;
}
