import { describe, expect, it } from "vitest";
import { mulberry32 } from "./rng.ts";

const take = (rng: () => number, n: number) =>
  Array.from({ length: n }, () => rng());

describe("mulberry32", () => {
  it("is fully determined by its seed", () => {
    expect(take(mulberry32(42), 5)).toEqual(take(mulberry32(42), 5));
    expect(take(mulberry32(42), 5)).not.toEqual(take(mulberry32(43), 5));
  });

  it("matches the reference sequence", () => {
    // Reference values from the canonical mulberry32 implementation.
    expect(take(mulberry32(1), 3)).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ]);
  });

  it("stays in [0, 1)", () => {
    for (const v of take(mulberry32(7), 10_000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
