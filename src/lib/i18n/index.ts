import { en, vi, type MessageKey, type Messages } from "@/lib/i18n/messages";

// UI localisation: English and Vietnamese. Plain dictionaries and a tiny
// translator, no runtime dependency. The active locale lives in the app store
// (persisted in localStorage like the theme); components read it with
// `useI18n()`. Pure helpers take a `Translator` and default to English so they
// stay testable without React.

export type { MessageKey };

export const LOCALES = ["en", "vi"] as const;
export type Locale = (typeof LOCALES)[number];

/** Each locale's own name, shown in the language toggle. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  vi: "Tiếng Việt",
};

/** Short label shown on the header toggle button. */
export const LOCALE_SHORT: Record<Locale, string> = {
  en: "EN",
  vi: "VI",
};

const DICTIONARIES: Record<Locale, Messages> = { en, vi };

export type Vars = Readonly<Record<string, string | number>>;

export interface Translator {
  (key: MessageKey, vars?: Vars): string;
  locale: Locale;
}

export const LOCALE_STORAGE_KEY = "stars-graph:locale";

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "vi";
}

function lookup(dict: Messages, key: MessageKey): string {
  return dict[key] ?? en[key];
}

export function createTranslator(locale: Locale): Translator {
  const dict = DICTIONARIES[locale];
  const t = ((key: MessageKey, vars?: Vars) => {
    let template: string = lookup(dict, key);
    // Singular form; `count` may arrive pre-formatted ("1").
    if (vars !== undefined && Number(vars.count) === 1) {
      const one = dict[`${key}_one` as MessageKey];
      if (one !== undefined) template = one;
    }
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = vars[name];
      return value === undefined ? match : String(value);
    });
  }) as Translator;
  t.locale = locale;
  return t;
}

const TRANSLATORS: Record<Locale, Translator> = {
  en: createTranslator("en"),
  vi: createTranslator("vi"),
};

/** Cached translator for a locale. */
export function translator(locale: Locale): Translator {
  return TRANSLATORS[locale];
}

/** English translator; the default for pure helpers and tests. */
export const enT = TRANSLATORS.en;

/** Stored choice, else the browser language (vi* → vi), else English. */
export function readLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // No window (tests) or storage blocked: fall through.
  }
  try {
    const langs = window.navigator.languages ?? [window.navigator.language];
    for (const lang of langs) {
      const base = lang.toLowerCase().split("-")[0];
      if (isLocale(base)) return base;
    }
  } catch {
    // No window (tests).
  }
  return "en";
}

export function writeLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage blocked (private mode etc.): the choice lasts for this session.
  }
}

/** Order the header toggle cycles through. */
export function nextLocale(locale: Locale): Locale {
  const i = LOCALES.indexOf(locale);
  return LOCALES[(i + 1) % LOCALES.length] ?? "en";
}
