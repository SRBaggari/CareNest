import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Translate } from "@/i18n";
import { getRequestTranslator } from "@/i18n/server";
import { formatLocalTime } from "@/lib/format";
import { simpleViewTarget } from "@/lib/simple-view";
import { pageContext } from "@/server/page";
import { listMyCircles } from "@/server/services/circles";
import { getMyToday } from "@/server/services/today";

export const metadata: Metadata = { title: "Home" };

export default async function AppHome() {
  const { session, ctx } = await pageContext("/app");
  const { locale, t } = await getRequestTranslator();
  const circles = await listMyCircles(ctx);
  // A parent lands on their own Simple view unless they chose the full app on this device.
  const target = simpleViewTarget(circles, (await cookies()).get("cn_view")?.value);
  if (target) redirect(target);
  const summary = await getMyToday(ctx);
  const status = new Map(summary.circles.map((c) => [c.circle.id, c]));

  return (
    <div lang={locale} className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold">{t("home.welcome", { name: session.user.name })}</h1>
        {summary.unreadNotifications > 0 && (
          <Link href="/app/notifications" className="mt-2 inline-flex min-h-12 items-center text-lg font-semibold underline">
            {t("home.unread", { count: summary.unreadNotifications })}
          </Link>
        )}
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
                  <CircleStatus today={status.get(c.id)} t={t} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One line per circle: a request for help outranks everything; otherwise how many things wait. */
function CircleStatus({ today, t }: { today?: Awaited<ReturnType<typeof getMyToday>>["circles"][number]; t: Translate }) {
  if (!today) return null;
  if (today.openHelpRequest) return <span className="mt-2 rounded-lg bg-danger px-3 py-2 font-bold text-primary-foreground">{t("home.helpOpen")}</span>;
  if (today.attention.length > 0) return <span className="mt-2 font-semibold text-warning">{t("home.attentionCount", { count: today.attention.length })}</span>;
  return <span className="mt-2 text-success">✓ {t("home.allClear")}</span>;
}
