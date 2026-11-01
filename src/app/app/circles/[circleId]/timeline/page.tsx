import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { getRequestTranslator } from "@/i18n/server";
import type { Translate } from "@/i18n";
import { formatDateTime } from "@/lib/format";
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

  return (
    <div className="flex flex-col gap-6">
      <p className="text-lg text-muted">{t("timeline.intro", { name })}</p>

      <form role="search" className="flex flex-wrap items-end gap-2">
        {kinds && <input type="hidden" name="kinds" value={kinds} />}
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t("timeline.searchLabel")}</span>
          <input type="search" name="q" defaultValue={q} maxLength={100} className="min-h-12 rounded-xl border-2 border-border bg-surface px-4 focus:border-primary text-lg" />
        </label>
        <button type="submit" className="min-h-12 rounded-xl bg-primary px-5 text-lg font-semibold text-primary-foreground shadow-sm transition hover:brightness-110">
          {t("timeline.search")}
        </button>
      </form>

      <nav aria-label={t("timeline.title")}>
        <ul className="flex flex-wrap gap-2">
          {[undefined, ...TIMELINE_KINDS].map((k) => (
            <li key={k ?? "all"}>
              <Link
                href={link({ kinds: k, before: undefined })}
                aria-current={kinds === k ? "page" : undefined}
                className={`inline-flex min-h-12 items-center rounded-full border-2 px-4 font-semibold ${kinds === k ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
              >
                {k ? t(`timeline.kind_${k}`) : t("timeline.all")}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {result.items.length === 0 && <p className="text-muted">{t("timeline.none")}</p>}
      <ol className="flex flex-col gap-2">
        {result.items.map((item) => {
          const { title, detail } = describe(item, t, name);
          const late = item.recordedAt && Math.abs(item.recordedAt.getTime() - item.at.getTime()) > 30 * 60_000;
          return (
            <li key={item.id} className="flex flex-col gap-1 rounded-xl border border-border bg-sunken p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={item.link} className="text-lg font-semibold hover:underline">
                  {item.isCorrection && <span className="mr-2 text-warning">{t("timeline.correction")}:</span>}
                  {title}
                </Link>
                <time className="text-muted" dateTime={item.at.toISOString()}>
                  {fmt(item.at)}
                </time>
              </div>
              {detail && <p className="whitespace-pre-line">{detail}</p>}
              <p className="text-muted">
                {t(`timeline.kind_${item.kind}`)}
                {item.kind !== "dose" && item.actor && ` · ${t("timeline.recordedBy", { name: item.actor })}`}
                {late && item.recordedAt && ` ${t("timeline.recordedAt", { when: fmt(item.recordedAt) })}`}
              </p>
            </li>
          );
        })}
      </ol>
      {result.nextBefore && (
        <Link href={link({ before: result.nextBefore })} className="self-start rounded-xl border-2 border-border bg-surface transition hover:border-primary px-5 py-3 font-semibold">
          {t("timeline.older")}
        </Link>
      )}
    </div>
  );
}
