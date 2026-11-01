import { CalendarDays, CircleCheck, DoorOpen, ListChecks, type LucideIcon, MessageSquareText, Pill, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/section";
import { getRequestTranslator } from "@/i18n/server";
import type { Translate } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import { localDateIn } from "@/server/domain/schedule";
import { orForbidden, orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { getTimeline, TIMELINE_KINDS, type TimelineItem } from "@/server/services/timeline";

export const metadata: Metadata = { title: "Timeline" };

function describe(item: TimelineItem, t: Translate, name: string): { title: string; detail?: string } {
  const d = item.data as Record<string, string | null | boolean>;
  switch (item.kind) {
    case "dose":
      return {
        title: t(`timeline.dose_${d.status}`, { medicine: String(d.medicine), scheduled: (d.scheduledTime as string) ?? t("timeline.dose_prn") }),
        detail: [item.source && item.actor ? t(`timeline.source_${item.source}`, { name: item.actor }) : null, d.reason].filter(Boolean).join(" — "),
      };
    case "appointment":
      return { title: t(`timeline.appointment_${d.status}`, { title: String(d.title) }), detail: (d.outcomeNote ?? d.cancelReason ?? undefined) as string | undefined };
    case "task":
      return { title: t("timeline.task_done", { title: String(d.title) }), detail: (d.note as string) ?? undefined };
    case "visit":
      return {
        title: t(d.status === "completed" ? "timeline.visit_completed" : "timeline.visit_in_progress", { name: item.actor ?? t("audit.someone") }),
        detail: d.detailsHidden ? t("visits.detailsHidden", { name }) : ([d.observations, d.unresolvedIssues].filter(Boolean).join(" — ") || undefined),
      };
    case "update":
      return { title: t("timeline.update_by", { name: item.actor ?? t("audit.someone") }), detail: String(d.body) };
    case "medication":
      return { title: t(`timeline.${String(d.action).replace(".", "_")}`, { name: String(d.name ?? "") }) };
  }
}

/** The icon and colour for an entry, so a day reads at a glance (green taken, amber unanswered). */
function lookOf(item: TimelineItem): { icon: LucideIcon; tone: string } {
  const status = (item.data as Record<string, unknown>).status;
  if (item.kind === "dose") {
    if (status === "taken" || status === "administered") return { icon: CircleCheck, tone: "bg-success-soft text-success" };
    if (status === "unconfirmed") return { icon: Pill, tone: "bg-warning-soft text-warning" };
    return { icon: Pill, tone: "bg-sunken text-muted" };
  }
  const icons: Record<string, LucideIcon> = { appointment: CalendarDays, task: ListChecks, visit: DoorOpen, update: MessageSquareText, medication: Pill };
  return { icon: icons[item.kind] ?? MessageSquareText, tone: "bg-primary-soft text-primary" };
}

export default async function TimelinePage({ params, searchParams }: PageProps<"/app/circles/[circleId]/timeline">) {
  const { circleId } = await params;
  const sp = await searchParams;
  const kinds = typeof sp.kinds === "string" ? sp.kinds : undefined;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const before = typeof sp.before === "string" ? sp.before : undefined;
  const { session, ctx } = await pageContext(`/app/circles/${circleId}/timeline`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const name = circle.profile.preferredName ?? circle.profile.displayName;

  let result;
  try {
    result = await orForbidden(getTimeline(ctx, circleId, { kinds, q, before }));
  } catch {
    result = await getTimeline(ctx, circleId, {});
  }
  if (!result) return <Alert>{t("common.notAllowed")}</Alert>;
  const fmt = (d: Date) => formatDateTime(d, locale, session.user.timeZone);
  const link = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ kinds, q, ...next }).filter(([, v]) => v) as [string, string][]);
    return `?${p.toString()}`;
  };

  const tz = session.user.timeZone;
  const today = localDateIn(tz, ctx.now);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const dayHeading = (date: string) => {
    const daysAgo = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
    if (daysAgo >= 0 && daysAgo <= 1) {
      const label = relative.format(-daysAgo, "day");
      return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
    }
    return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  };
  const time = (d: Date) => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
  const days = new Map<string, typeof result.items>();
  for (const item of result.items) {
    const date = localDateIn(tz, item.at);
    days.set(date, [...(days.get(date) ?? []), item]);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold">{t("timeline.title")}</h2>
        <p className="text-muted">{t("timeline.intro", { name })}</p>
      </div>

      <form role="search" className="flex max-w-xl items-end gap-2">
        {kinds && <input type="hidden" name="kinds" value={kinds} />}
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-semibold">{t("timeline.searchLabel")}</span>
          <span className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted" />
            <input type="search" name="q" defaultValue={q} maxLength={100} className="min-h-12 w-full rounded-xl border-2 border-border bg-surface pr-4 pl-10 text-lg focus:border-primary" />
          </span>
        </label>
        <button type="submit" className={buttonClass("primary")}>
          {t("timeline.search")}
        </button>
      </form>

      <nav aria-label={t("timeline.title")} className="-mx-4 sm:mx-0">
        <ul className="scrollbar-none flex gap-2 overflow-x-auto px-4 sm:flex-wrap sm:px-0">
          {[undefined, ...TIMELINE_KINDS].map((k) => (
            <li key={k ?? "all"} className="shrink-0">
              <Link
                href={link({ kinds: k, before: undefined })}
                aria-current={kinds === k ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full px-4 font-semibold transition ${
                  kinds === k ? "bg-primary text-primary-foreground shadow-sm" : "bg-surface text-muted ring-1 ring-border hover:text-foreground"
                }`}
              >
                {k ? t(`timeline.kind_${k}`) : t("timeline.all")}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {result.items.length === 0 && <p className="text-muted">{t("timeline.none")}</p>}
      {[...days].map(([date, items]) => (
        <section key={date} aria-labelledby={`tl-${date}`}>
          <h3 id={`tl-${date}`} className="mb-3 text-base font-bold tracking-wide text-muted uppercase">
            {dayHeading(date)}
          </h3>
          <ol className="relative flex flex-col gap-1 before:absolute before:top-2 before:bottom-2 before:left-5 before:w-0.5 before:bg-border">
            {items.map((item) => {
              const { title, detail } = describe(item, t, name);
              const late = item.recordedAt && Math.abs(item.recordedAt.getTime() - item.at.getTime()) > 30 * 60_000;
              const look = lookOf(item);
              return (
                <li key={item.id} className="relative flex gap-4 py-2">
                  <span aria-hidden="true" className={`relative z-10 inline-flex size-10 shrink-0 items-center justify-center rounded-full ring-4 ring-background ${look.tone}`}>
                    <look.icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1 rounded-2xl border border-border bg-surface px-4 py-3 shadow-card">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <Link href={item.link} className="font-bold hover:text-primary hover:underline">
                        {title}
                      </Link>
                      <time className="text-base text-muted" dateTime={item.at.toISOString()}>
                        {time(item.at)}
                      </time>
                    </div>
                    {item.isCorrection && (
                      <div className="mt-1">
                        <Badge tone="warning">{t("timeline.correction")}</Badge>
                      </div>
                    )}
                    {detail && <p className="mt-1 whitespace-pre-line">{detail}</p>}
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-base text-muted">
                      <Badge>{t(`timeline.kind_${item.kind}`)}</Badge>
                      {item.kind !== "dose" && item.actor && <span>{t("timeline.recordedBy", { name: item.actor })}</span>}
                      {late && item.recordedAt && <span>{t("timeline.recordedAt", { when: fmt(item.recordedAt) })}</span>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {result.nextBefore && (
        <Link href={link({ before: result.nextBefore })} className={`${buttonClass("secondary")} self-start`}>
          {t("timeline.older")}
        </Link>
      )}
    </div>
  );
}
