import en from "./messages/en.json";
import hi from "./messages/hi.json";
import ta from "./messages/ta.json";
import te from "./messages/te.json";

export const LOCALES = ["en", "hi", "te", "ta"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "cn_locale";

/** Native names, shown in the language picker so people can find their own language. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
  te: "తెలుగు",
  ta: "தமிழ்",
};

type Messages = { [key: string]: string | Messages };

const CATALOGS: Record<Locale, Messages> = { en, hi, te, ta };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the UI language: explicit user preference, then the locale cookie, then the first
 * supported Accept-Language entry, then English.
 */
export function resolveLocale(input: {
  userPreference?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (isLocale(input.userPreference)) return input.userPreference;
  if (isLocale(input.cookie)) return input.cookie;
  const ranked = (input.acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { base: tag.toLowerCase().split("-")[0], q: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter((entry) => entry.base && !Number.isNaN(entry.q))
    .sort((a, b) => b.q - a.q);
  for (const entry of ranked) {
    if (isLocale(entry.base)) return entry.base;
  }
  return DEFAULT_LOCALE;
}

function lookup(messages: Messages, key: string): string | undefined {
  let node: string | Messages | undefined = messages;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Returns a translate function. Missing translations fall back to English, then to the key
 * itself, so a partially translated language never shows a blank label.
 */
export function getTranslator(locale: Locale): Translate {
  const catalog = CATALOGS[locale];
  return (key, vars) => {
    const template = lookup(catalog, key) ?? lookup(CATALOGS.en, key) ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in vars ? String(vars[name]) : match,
    );
  };
}

/** Flattens a catalog into dot-path keys (used by tests to check catalog consistency). */
export function flattenKeys(messages: Messages, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([k, v]) =>
    typeof v === "string" ? [`${prefix}${k}`] : flattenKeys(v, `${prefix}${k}.`),
  );
}

export const catalogs = CATALOGS;
