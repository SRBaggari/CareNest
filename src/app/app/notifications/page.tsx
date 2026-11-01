import { Bell, CalendarDays, Car, DoorOpen, LifeBuoy, ListChecks, type LucideIcon, MessageSquareText, MessagesSquare, PackageOpen, Pill, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { buttonClass } from "@/components/ui/button";
import { Badge, IconTile, type Tone } from "@/components/ui/section";
import { getRequestTranslator } from "@/i18n/server";
import { localDateIn } from "@/server/domain/schedule";
import { pageContext } from "@/server/page";
import { listNotifications } from "@/server/services/notifications";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Notifications" };

/** An icon for what the notification is about, so a list can be scanned at a glance. */
function iconFor(kind: string): LucideIcon {
  if (kind.startsWith("assistance")) return LifeBuoy;
  if (kind.startsWith("refill")) return PackageOpen;
  if (kind.includes("dose") || kind.startsWith("unconfirmed") || kind.startsWith("reminder")) return Pill;
  if (kind.startsWith("transport")) return Car;
  if (kind.startsWith("appointment")) return CalendarDays;
  if (kind.startsWith("task")) return ListChecks;
  if (kind.startsWith("visit")) return DoorOpen;
  if (kind.startsWith("message")) return MessagesSquare;
  if (kind.includes("update")) return MessageSquareText;
  if (kind.startsWith("invitation")) return UserPlus;
  return Bell;
}
const toneFor: Record<string, Tone> = { critical: "danger", high: "warning", normal: "primary", low: "neutral" };

export default async function NotificationsPage() {
  const { session, ctx } = await pageContext("/app/notifications");
  const { locale, t } = await getRequestTranslator();
  const { notifications, unreadCount } = await listNotifications(ctx, { limit: 50 });
  const messages = { network: t("common.errorNetwork"), generic: t("common.errorGeneric"), fixErrors: t("common.fixErrors") };
  const tz = session.user.timeZone;

  // Group by day in the reader's own time zone: Today, Yesterday, then dates.
  const today = localDateIn(tz, ctx.now);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const capitalise = (s: string) => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
  const dayHeading = (date: string) => {
    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
    return days <= 1 ? capitalise(relative.format(-days, "day")) : new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  };
  const time = (d: Date) => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
  const groups = new Map<string, typeof notifications>();
  for (const n of notifications) {
    const date = localDateIn(tz, n.createdAt);
    groups.set(date, [...(groups.get(date) ?? []), n]);
  }

  return (
    <div lang={locale} className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{t("inbox.title")}</h1>
        {unreadCount > 0 && (
          <ActionButton method="POST" url="/api/v1/notifications/read-all" variant="ghost" messages={messages}>
            {t("inbox.markAllRead")}
          </ActionButton>
        )}
      </div>

      {notifications.length === 0 ? (
        <EmptyState icon={Bell}>{t("inbox.empty")}</EmptyState>
      ) : (
        [...groups].map(([date, items]) => (
          <section key={date} aria-labelledby={`day-${date}`} className="flex flex-col gap-3">
            <h2 id={`day-${date}`} className="text-base font-bold tracking-wide text-muted uppercase">
              {dayHeading(date)}
            </h2>
            <ol className="flex flex-col gap-3">
              {items.map((n) => {
                const others = n.acknowledgedBy.filter((a) => a.userId !== session.user.id);
                const urgent = n.priority === "high" || n.priority === "critical";
                const unread = !n.readAt;
                return (
                  <li
                    key={n.id}
                    className={`card flex gap-4 ${n.priority === "critical" && !n.acknowledgedAt ? "border-2 border-danger" : ""} ${unread ? "" : "opacity-90 shadow-none"}`}
                  >
                    <div className="relative">
                      <IconTile icon={iconFor(n.kind)} tone={toneFor[n.priority]} />
                      {unread && <span aria-hidden="true" className="absolute -top-1 -right-1 size-3.5 rounded-full border-2 border-surface bg-primary" />}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <h3 className={`text-lg ${unread ? "font-bold" : "font-semibold"}`}>
                          {unread && <span className="sr-only">{t("inbox.unread")}: </span>}
                          {n.title}
                        </h3>
                        <time className="text-base text-muted" dateTime={n.createdAt.toISOString()}>
                          {time(n.createdAt)}
                        </time>
                      </div>
                      {t(`inbox.priority_${n.priority}`) && (
                        <div>
                          <Badge tone={toneFor[n.priority]}>{t(`inbox.priority_${n.priority}`)}</Badge>
                        </div>
                      )}
                      {n.body && <p className="line-clamp-3 text-muted">{n.body}</p>}
                      {n.acknowledgedAt && <p className="font-semibold text-success">✓ {t("inbox.youAreChecking")}</p>}
                      {others.length > 0 && <p className="font-semibold">{t("inbox.othersChecking", { names: others.map((a) => a.name).join(", ") })}</p>}
                      {n.emailStatus && n.emailStatus !== "logged" && <p className="text-base text-muted">{t(`inbox.email_${n.emailStatus}`)}</p>}
                      <div className="flex flex-wrap items-start gap-2">
                        {urgent && !n.acknowledgedAt && (
                          <ActionButton method="POST" url={`/api/v1/notifications/${n.id}/acknowledge`} variant="primary" messages={messages}>
                            {t("inbox.checking")}
                          </ActionButton>
                        )}
                        {n.link && (
                          <Link href={n.link} className={buttonClass("secondary")}>
                            {t("inbox.open")}
                          </Link>
                        )}
                        {unread && (
                          <ActionButton method="POST" url={`/api/v1/notifications/${n.id}/read`} variant="ghost" messages={messages}>
                            {t("inbox.markRead")}
                          </ActionButton>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}
