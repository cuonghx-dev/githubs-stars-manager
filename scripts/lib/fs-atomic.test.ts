import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readJsonOr, writeJsonAtomic, writeTextAtomic } from "./fs-atomic.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fs-atomic-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeTextAtomic", () => {
  it("creates parent dirs and writes the file", async () => {
    const target = join(dir, "a", "b", "out.txt");
    await writeTextAtomic(target, "hello");
    expect(await readFile(target, "utf8")).toBe("hello");
  });

  it("replaces an existing file and leaves no temp files", async () => {
    const target = join(dir, "out.txt");
    await writeFile(target, "old");
    await writeTextAtomic(target, "new");
    expect(await readFile(target, "utf8")).toBe("new");
    expect(await readdir(dir)).toEqual(["out.txt"]);
  });

  it("keeps the old file and cleans up when the rename fails", async () => {
    // Target is a non-empty directory, so rename() over it fails.
    const target = join(dir, "busy");
    await writeTextAtomic(join(target, "inner.txt"), "x");
    await expect(writeTextAtomic(target, "new")).rejects.toThrow();
    expect(await readdir(dir)).toEqual(["busy"]);
    expect(await readFile(join(target, "inner.txt"), "utf8")).toBe("x");
  });
});

describe("writeJsonAtomic / readJsonOr", () => {
  it("round-trips pretty JSON with a trailing newline", async () => {
    const target = join(dir, "data.json");
    await writeJsonAtomic(target, { a: 1, b: [2] });
    expect(await readFile(target, "utf8")).toBe(
      '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}\n',
    );
    expect(await readJsonOr(target, null)).toEqual({ a: 1, b: [2] });
  });

  it("returns the fallback when the file is missing", async () => {
    expect(await readJsonOr(join(dir, "nope.json"), { empty: true })).toEqual({
      empty: true,
    });
  });

  it("throws on invalid JSON instead of hiding it", async () => {
    const target = join(dir, "bad.json");
    await writeFile(target, "{not json");
    await expect(readJsonOr(target, {})).rejects.toThrow(SyntaxError);
  });
});
