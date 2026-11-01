import { describe, expect, it } from "vitest";
import { catalogs, flattenKeys, getTranslator, LOCALES, resolveLocale } from "./index";

describe("resolveLocale", () => {
  it("prefers the user's saved preference over everything else", () => {
    expect(resolveLocale({ userPreference: "ta", cookie: "hi", acceptLanguage: "te" })).toBe("ta");
  });

  it("falls back to the cookie, then Accept-Language", () => {
    expect(resolveLocale({ cookie: "hi", acceptLanguage: "te" })).toBe("hi");
    expect(resolveLocale({ acceptLanguage: "te-IN,te;q=0.9,en;q=0.8" })).toBe("te");
  });

  it("honours Accept-Language quality ordering and skips unsupported languages", () => {
    expect(resolveLocale({ acceptLanguage: "fr-FR, de;q=0.9, ta;q=0.5, hi;q=0.7" })).toBe("hi");
  });

  it("ignores invalid values and defaults to English", () => {
    expect(resolveLocale({ userPreference: "xx", cookie: "<script>", acceptLanguage: "fr" })).toBe("en");
    expect(resolveLocale({})).toBe("en");
  });
});

describe("getTranslator", () => {
  it("translates and interpolates variables", () => {
    const t = getTranslator("en");
    expect(t("app.name")).toBe("CareNest");
    expect(getTranslator("hi")("landing.signIn")).toBe("साइन इन करें");
  });

  it("falls back to English for untranslated keys, then to the key itself", () => {
    // Every key is translated now, so remove one Telugu string for the duration of the test.
    const landing = catalogs.te.landing as Record<string, string>;
    const saved = landing.featureMedsTitle;
    delete landing.featureMedsTitle;
    try {
      expect(getTranslator("te")("landing.featureMedsTitle")).toBe("Medicines, clearly tracked");
    } finally {
      landing.featureMedsTitle = saved;
    }
    expect(getTranslator("ta")("does.not.exist")).toBe("does.not.exist");
  });

  it("leaves unknown placeholders intact", () => {
    const t = getTranslator("en");
    expect(t("app.name", { unused: 1 })).toBe("CareNest");
  });
});

describe("message catalogs", () => {
  const englishKeys = new Set(flattenKeys(catalogs.en));

  it.each(LOCALES.filter((l) => l !== "en"))("%s has no keys missing from English (no orphans)", (locale) => {
    const orphans = flattenKeys(catalogs[locale]).filter((k) => !englishKeys.has(k));
    expect(orphans).toEqual([]);
  });

  it("every language translates the safety disclaimer", () => {
    for (const locale of LOCALES) {
      expect(flattenKeys(catalogs[locale])).toContain("safety.notEmergencyService");
    }
  });
});

describe("audit action labels", () => {
  it("every recorded audit action has an English label", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const dir = "src/server/services";
    const actions = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      for (const match of readFileSync(`${dir}/${file}`, "utf8").matchAll(/action: (?:[^"\n]*\? )?"([a-z_]+\.[a-z_]+)"(?: : "([a-z_]+\.[a-z_]+)")?/g)) {
        actions.add(match[1]);
        if (match[2]) actions.add(match[2]);
      }
    }
    expect(actions.size).toBeGreaterThan(5);
    const t = getTranslator("en");
    for (const action of actions) {
      const key = `audit.${action.replaceAll(".", "_")}`;
      expect(t(key), `missing label for ${action}`).not.toBe(key);
    }
  });
});

describe("translations", () => {
  const english = flattenKeys(catalogs.en);
  const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

  // Missing strings would silently show English to someone who chose Hindi, Telugu or Tamil;
  // on the parent's own screen and in emergency alerts that is not acceptable.
  it.each(LOCALES.filter((l) => l !== "en"))("%s translates every English string", (locale) => {
    const have = new Set(flattenKeys(catalogs[locale]));
    expect(english.filter((k) => !have.has(k))).toEqual([]);
  });

  it.each(LOCALES.filter((l) => l !== "en"))("%s keeps every {placeholder} so names and times are filled in", (locale) => {
    const en = getTranslator("en");
    const t = getTranslator(locale);
    const wrong = english.filter((key) => placeholders(t(key)).join() !== placeholders(en(key)).join());
    expect(wrong).toEqual([]);
  });

  it("keeps the literal word DELETE in the account-deletion prompt, because that is what must be typed", () => {
    for (const locale of LOCALES) expect(getTranslator(locale)("data.confirmLabel")).toContain("DELETE");
  });
});
