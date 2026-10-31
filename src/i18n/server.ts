import { cookies, headers } from "next/headers";
import { getCurrentSession } from "@/server/auth/current-user";
import { getTranslator, LOCALE_COOKIE, resolveLocale, type Locale, type Translate } from "./index";

/** Resolves the request's locale: signed-in user's preference, then cookie, then Accept-Language. */
export async function getRequestLocale(): Promise<Locale> {
  const [cookieStore, headerStore, session] = await Promise.all([cookies(), headers(), getCurrentSession()]);
  return resolveLocale({
    userPreference: session?.user.locale,
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });
}

export async function getRequestTranslator(): Promise<{ locale: Locale; t: Translate }> {
  const locale = await getRequestLocale();
  return { locale, t: getTranslator(locale) };
}
