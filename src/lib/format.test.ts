import { describe, expect, it } from "vitest";
import {
  formatFreshness,
  formatRelativeTime,
  formatRepoCount,
} from "@/lib/format";

const now = new Date("2026-11-15T12:00:00Z");

describe("formatRelativeTime", () => {
  it("formats past times in the largest whole unit", () => {
    expect(formatRelativeTime("2026-11-12T12:00:00Z", now)).toBe("3 days ago");
    expect(formatRelativeTime("2026-11-15T10:00:00Z", now)).toBe("2 hours ago");
    expect(formatRelativeTime("2026-11-14T12:00:00Z", now)).toBe("yesterday");
    expect(formatRelativeTime("2025-11-15T12:00:00Z", now)).toBe("last year");
  });

  it("says just now under a minute", () => {
    expect(formatRelativeTime("2026-11-15T11:59:30Z", now)).toBe("just now");
  });

  it("handles invalid input", () => {
    expect(formatRelativeTime("nope", now)).toBe("at an unknown time");
  });
});

describe("formatRepoCount", () => {
  it("pluralises and groups digits", () => {
    expect(formatRepoCount(1)).toBe("1 repo");
    expect(formatRepoCount(812)).toBe("812 repos");
    expect(formatRepoCount(1200)).toBe("1,200 repos");
  });
});

describe("formatFreshness", () => {
  it("builds the header line (FR-37)", () => {
    expect(formatFreshness("2026-11-12T12:00:00Z", 812, now)).toBe(
      "Generated 3 days ago · 812 repos",
    );
  });
});
