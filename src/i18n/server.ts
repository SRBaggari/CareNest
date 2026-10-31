import { cookies, headers } from "next/headers";
import { getTranslator, LOCALE_COOKIE, resolveLocale, type Locale, type Translate } from "./index";

/** Resolves the request's locale from cookie / Accept-Language (user preference added with auth). */
export async function getRequestLocale(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });
}

export async function getRequestTranslator(): Promise<{ locale: Locale; t: Translate }> {
  const locale = await getRequestLocale();
  return { locale, t: getTranslator(locale) };
}
