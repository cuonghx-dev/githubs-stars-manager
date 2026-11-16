import { describe, expect, it } from "vitest";
import { edgeReason } from "@/features/detail/reasons";
import { categoryLabel, formatDate } from "@/features/detail/repo-details";
import { formatFreshness, formatRepoCount } from "@/lib/format";
import { en, vi } from "@/lib/i18n/messages";
import { enT, nextLocale, translator } from "@/lib/i18n";

const viT = translator("vi");
const now = new Date("2026-11-15T12:00:00Z");

describe("translator", () => {
  it("fills placeholders and keeps unknown ones", () => {
    expect(enT("timeline.upTo", { day: "2026-01-02" })).toBe(
      "Up to 2026-01-02",
    );
    expect(enT("timeline.upTo")).toBe("Up to {day}");
  });

  it("uses the singular form when count is 1", () => {
    expect(enT("count.hops", { count: 1 })).toBe("1 hop");
    expect(enT("count.hops", { count: 3 })).toBe("3 hops");
    expect(viT("count.hops", { count: 1 })).toBe("1 bước");
  });

  it("translates to Vietnamese", () => {
    expect(viT("view.graph")).toBe("Đồ thị");
    expect(viT("detail.onlyCluster", { label: "react" })).toBe(
      "Chỉ hiện cụm “react”",
    );
  });

  it("has no Vietnamese key that English lacks", () => {
    const extra = Object.keys(vi).filter((k) => !(k in en));
    expect(extra).toEqual([]);
  });

  it("cycles locales", () => {
    expect(nextLocale("en")).toBe("vi");
    expect(nextLocale("vi")).toBe("en");
  });
});

describe("localised helpers", () => {
  it("formats the freshness line in Vietnamese", () => {
    expect(formatFreshness("2026-11-12T12:00:00Z", 1200, now, viT)).toBe(
      "Tạo 3 ngày trước · 1.200 repo",
    );
    expect(formatRepoCount(1, viT)).toBe("1 repo");
  });

  it("localises dates, categories and edge reasons", () => {
    expect(formatDate("nope", viT)).toBe("không rõ");
    expect(categoryLabel("tool", viT)).toBe("Công cụ");
    expect(
      edgeReason({ semantic: 0.8, sharedTopics: ["react"], owner: true }, viT),
    ).toBe("README tương đồng 0.80 · chung chủ đề: react · cùng chủ sở hữu");
  });
});
