import { Archive, Bell, CalendarDays, ChevronRight, CircleCheck, Clock, LifeBuoy, Pill, Plus, TriangleAlert, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { Avatar, Badge, IconTile } from "@/components/ui/section";
import type { Translate } from "@/i18n";
import { getRequestTranslator } from "@/i18n/server";
import { formatDateTime, formatLocalTime } from "@/lib/format";
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
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold sm:text-4xl">{t("home.welcome", { name: session.user.name })}</h1>
        {summary.unreadNotifications > 0 && (
          <Link
            href="/app/notifications"
            className="inline-flex min-h-12 items-center gap-2 self-start rounded-full bg-primary-soft px-4 font-semibold text-primary hover:brightness-95"
          >
            <Bell aria-hidden="true" className="size-5" />
            {t("home.unread", { count: summary.unreadNotifications })}
            <ChevronRight aria-hidden="true" className="size-5" />
          </Link>
        )}
      </div>

      <section aria-labelledby="circles-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="circles-heading" className="text-2xl font-bold">
            {t("home.circlesTitle")}
          </h2>
          <Link href="/app/circles/new" className={buttonClass("primary")}>
            <Plus aria-hidden="true" className="size-5" />
            {t("home.createCircle")}
          </Link>
        </div>

        {circles.length === 0 ? (
          <div className="card flex flex-col items-start gap-3">
            <IconTile icon={UsersRound} size="lg" />
            <p className="text-xl font-bold">{t("home.noCircles")}</p>
            <p className="max-w-2xl text-muted">{t("home.noCirclesHint")}</p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {circles.map((c) => (
              <li key={c.id}>
                <Link href={`/app/circles/${c.id}`} className="card group flex h-full flex-col gap-4 transition hover:border-primary">
                  <div className="flex items-center gap-4">
                    <Avatar name={c.preferredName ?? c.recipientName} />
                    <div className="min-w-0 flex-1">
                      <span className="block text-xl font-bold group-hover:text-primary">{c.name}</span>
                      <span className="block text-muted">{c.preferredName ? `${c.preferredName} · ${c.recipientName}` : c.recipientName}</span>
                    </div>
                    <ChevronRight aria-hidden="true" className="size-6 shrink-0 text-muted group-hover:text-primary" />
                  </div>
                  <div className="flex flex-col gap-1 text-muted">
                    <span>{t("home.yourRole", { role: t(`roles.${c.role}`) })}</span>
                    <span className="inline-flex items-center gap-2">
                      <Clock aria-hidden="true" className="size-4" />
                      {t("home.localTime", { time: formatLocalTime(ctx.now, locale, c.timeZone) })}
                    </span>
                  </div>
                  {status.get(c.id) && <CircleGlance today={status.get(c.id)!} t={t} locale={locale} timeZone={session.user.timeZone} />}
                  <div className="mt-auto">
                    {c.status === "archived" ? (
                      <Badge tone="warning">
                        <Archive aria-hidden="true" className="size-4" />
                        {t("home.archived")}
                      </Badge>
                    ) : (
                      <CircleStatus today={status.get(c.id)} t={t} />
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type CircleSummary = Awaited<ReturnType<typeof getMyToday>>["circles"][number];

/** Today's medicines as a small progress bar, and the next appointment, where the reader may see them. */
function CircleGlance({ today, t, locale, timeZone }: { today: CircleSummary; t: Translate; locale: string; timeZone: string }) {
  const d = today.doses;
  const total = d ? Object.values(d).reduce((a, b) => a + b, 0) : 0;
  const done = d ? d.taken + d.administered + d.skipped + d.refused : 0;
  if (total === 0 && !today.nextAppointment) return null;
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-sunken/60 p-3">
      {d && total > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="inline-flex items-center gap-2 font-semibold">
            <Pill aria-hidden="true" className="size-4 shrink-0 text-primary" />
            {t("home.dosesToday", { done, total })}
          </span>
          <span aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-surface ring-1 ring-border">
            <span className="h-full rounded-full bg-success" style={{ width: `${(done / total) * 100}%` }} />
            {d.unconfirmed > 0 && <span className="h-full bg-warning" style={{ width: `${(d.unconfirmed / total) * 100}%` }} />}
          </span>
        </div>
      )}
      {today.nextAppointment && (
        <span className="inline-flex items-start gap-2">
          <CalendarDays aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary" />
          {t("home.nextAppointment", { title: today.nextAppointment.title, when: formatDateTime(today.nextAppointment.startsAt, locale, timeZone) })}
        </span>
      )}
    </div>
  );
}

/** One line per circle: a request for help outranks everything; otherwise how many things wait. */
function CircleStatus({ today, t }: { today?: CircleSummary; t: Translate }) {
  if (!today) return null;
  if (today.openHelpRequest) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-danger px-4 py-1 font-bold text-primary-foreground">
        <LifeBuoy aria-hidden="true" className="size-5" />
        {t("home.helpOpen")}
      </span>
    );
  }
  if (today.attention.length > 0) {
    return (
      <Badge tone="warning">
        <TriangleAlert aria-hidden="true" className="size-4" />
        {t("home.attentionCount", { count: today.attention.length })}
      </Badge>
    );
  }
  return (
    <Badge tone="success">
      <CircleCheck aria-hidden="true" className="size-4" />
      {t("home.allClear")}
    </Badge>
  );
}
