import { describe, expect, it } from "vitest";
import {
  findCluster,
  formatCount,
  formatDate,
  homepageHref,
  homepageLabel,
  isOnlyCluster,
  toggleClusterFilter,
} from "@/features/detail/repo-details";

describe("formatCount", () => {
  it("uses compact notation", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1234)).toBe("1.2K");
    expect(formatCount(230000)).toBe("230K");
    expect(formatCount(1_500_000)).toBe("1.5M");
  });
});

describe("formatDate", () => {
  it("formats in UTC", () => {
    expect(formatDate("2020-01-02T03:04:05Z")).toBe("Jan 2, 2020");
    expect(formatDate("2026-11-15T23:30:00-05:00")).toBe("Nov 16, 2026");
  });

  it("handles invalid input", () => {
    expect(formatDate("nope")).toBe("unknown");
  });
});

describe("homepageHref", () => {
  it("keeps http(s) URLs", () => {
    expect(homepageHref("https://react.dev")).toBe("https://react.dev/");
    expect(homepageHref("http://example.com/docs")).toBe(
      "http://example.com/docs",
    );
  });

  it("adds https to bare hosts", () => {
    expect(homepageHref("  react.dev ")).toBe("https://react.dev/");
    expect(homepageHref("example.com/a?b=1")).toBe("https://example.com/a?b=1");
  });

  it("drops empty and non-http values", () => {
    expect(homepageHref(undefined)).toBeNull();
    expect(homepageHref("   ")).toBeNull();
    expect(homepageHref("javascript:alert(1)")).toBeNull();
    expect(homepageHref("mailto:a@b.c")).toBeNull();
    expect(homepageHref("ftp://example.com")).toBeNull();
    expect(homepageHref("https://")).toBeNull();
  });
});

describe("homepageLabel", () => {
  it("shows host and path without www or trailing slash", () => {
    expect(homepageLabel("https://react.dev/")).toBe("react.dev");
    expect(homepageLabel("https://www.example.com/docs/")).toBe(
      "example.com/docs",
    );
  });
});

describe("findCluster", () => {
  const clusters = [
    { id: 0, label: "react · ui", color: "#4f7cff", size: 2 },
    { id: -1, label: "Unclustered", color: "#9ca3af", size: 1 },
  ];

  it("finds by id", () => {
    expect(findCluster(clusters, 0).label).toBe("react · ui");
    expect(findCluster(clusters, -1).label).toBe("Unclustered");
  });

  it("falls back for unknown ids", () => {
    expect(findCluster([], -1)).toMatchObject({ label: "Unclustered" });
    expect(findCluster(clusters, 7)).toMatchObject({
      id: 7,
      label: "Cluster 7",
    });
  });
});

describe("cluster chip filter", () => {
  it("filters to the clicked cluster", () => {
    expect(toggleClusterFilter([], 3)).toEqual([3]);
    expect(toggleClusterFilter([1, 2], 3)).toEqual([3]);
    expect(toggleClusterFilter([1, 3], 3)).toEqual([3]);
  });

  it("clears when it is already the only cluster", () => {
    expect(isOnlyCluster([3], 3)).toBe(true);
    expect(isOnlyCluster([3, 4], 3)).toBe(false);
    expect(toggleClusterFilter([3], 3)).toEqual([]);
  });
});
