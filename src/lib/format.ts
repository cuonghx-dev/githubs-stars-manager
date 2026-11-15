// Display formatting for the header (FR-37): "Generated 3 days ago · 812 repos".

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
  locale = "en",
): string {
  const seconds = Math.round((Date.parse(iso) - now.getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "at an unknown time";
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size)
      return rtf.format(Math.trunc(seconds / size), unit);
  }
  return "just now";
}

export function formatRepoCount(count: number, locale = "en"): string {
  const n = new Intl.NumberFormat(locale).format(count);
  return `${n} ${count === 1 ? "repo" : "repos"}`;
}

/** Header freshness line (FR-37). */
export function formatFreshness(
  generatedAt: string,
  repoCount: number,
  now?: Date,
): string {
  return `Generated ${formatRelativeTime(generatedAt, now)} · ${formatRepoCount(repoCount)}`;
}
