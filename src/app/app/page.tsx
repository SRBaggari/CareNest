import type { Metadata } from "next";
import Link from "next/link";
import { getRequestTranslator } from "@/i18n/server";
import { formatLocalTime } from "@/lib/format";
import { pageContext } from "@/server/page";
import { listMyCircles } from "@/server/services/circles";

export const metadata: Metadata = { title: "Home" };

export default async function AppHome() {
  const { session, ctx } = await pageContext("/app");
  const { locale, t } = await getRequestTranslator();
  const circles = await listMyCircles(ctx);

  return (
    <div lang={locale} className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold">{t("home.welcome", { name: session.user.name })}</h1>
      </div>

      <section aria-labelledby="circles-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="circles-heading" className="text-2xl font-semibold">
            {t("home.circlesTitle")}
          </h2>
          <Link
            href="/app/circles/new"
            className="inline-flex min-h-12 items-center rounded-lg bg-primary px-5 font-semibold text-primary-foreground"
          >
            {t("home.createCircle")}
          </Link>
        </div>

        {circles.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-6">
            <p className="text-lg font-semibold">{t("home.noCircles")}</p>
            <p className="mt-2 text-muted">{t("home.noCirclesHint")}</p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {circles.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/app/circles/${c.id}`}
                  className="flex h-full flex-col gap-1 rounded-xl border-2 border-border bg-surface p-5 hover:border-primary"
                >
                  <span className="text-xl font-semibold">{c.name}</span>
                  <span>{c.preferredName ? `${c.preferredName} · ${c.recipientName}` : c.recipientName}</span>
                  <span className="text-muted">{t("home.yourRole", { role: t(`roles.${c.role}`) })}</span>
                  <span className="text-muted">{t("home.localTime", { time: formatLocalTime(ctx.now, locale, c.timeZone) })}</span>
                  {c.status === "archived" && <span className="font-semibold text-warning">{t("home.archived")}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
