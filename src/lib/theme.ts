import type { ThemePreference } from "@/lib/store";

// Theme (NFR-8, T3.9): follow the system colour scheme by default, with a
// manual light/dark override persisted in localStorage. The inline script in
// index.html applies the same rules before first paint to avoid a flash; keep
// THEME_STORAGE_KEY in sync with it.

export const THEME_STORAGE_KEY = "stars-graph:theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isPreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/** Stored override, or "system" when none (or storage is unavailable). */
export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** Persists the preference; "system" clears the override. */
export function writeThemePreference(theme: ThemePreference): void {
  try {
    if (theme === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private mode etc.): the choice lasts for this session.
  }
}

function resolveDark(theme: ThemePreference): boolean {
  if (theme === "system") return window.matchMedia(DARK_QUERY).matches;
  return theme === "dark";
}

/**
 * Applies the preference to <html> and, for "system", keeps following the OS
 * scheme. Returns a cleanup that stops listening.
 */
export function applyTheme(theme: ThemePreference): () => void {
  const root = document.documentElement;
  const apply = () => {
    const dark = resolveDark(theme);
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
  };
  apply();
  if (theme !== "system") return () => {};
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", apply);
  return () => mq.removeEventListener("change", apply);
}

/** Order the header toggle cycles through. */
export function nextThemePreference(theme: ThemePreference): ThemePreference {
  if (theme === "system") return "light";
  if (theme === "light") return "dark";
  return "system";
}
