import { enT, type Translator } from "@/lib/i18n";

// Display formatting for the header (FR-37): "Generated 3 days ago · 812 repos".
// Every helper takes a translator (English by default); its locale also drives
// the Intl number and relative-time formats.

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** Relative time of `iso` against `now`, e.g. "3 days ago", "just now". */
export function formatRelativeTime(
  iso: string,
  now: Date = new Date(),
  t: Translator = enT,
): string {
  const seconds = Math.round((Date.parse(iso) - now.getTime()) / 1000);
  if (!Number.isFinite(seconds)) return t("time.unknown");
  const rtf = new Intl.RelativeTimeFormat(t.locale, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size)
      return rtf.format(Math.trunc(seconds / size), unit);
  }
  return t("time.justNow");
}

export function formatRepoCount(count: number, t: Translator = enT): string {
  return t("count.repos", {
    count: new Intl.NumberFormat(t.locale).format(count),
  });
}

/** Header freshness line (FR-37). */
export function formatFreshness(
  generatedAt: string,
  repoCount: number,
  now?: Date,
  t: Translator = enT,
): string {
  return t("freshness", {
    time: formatRelativeTime(generatedAt, now, t),
    repos: formatRepoCount(repoCount, t),
  });
}
