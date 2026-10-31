import type { Metadata } from "next";
import { getRequestTranslator } from "@/i18n/server";
import { requireSession } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Home" };

export default async function AppHome() {
  const session = await requireSession("/app");
  const { locale, t } = await getRequestTranslator();
  return (
    <div lang={locale}>
      <h1 className="text-3xl font-bold">{t("home.welcome", { name: session.user.name })}</h1>
      <p className="mt-3 text-lg text-muted">{t("home.intro")}</p>
    </div>
  );
}
