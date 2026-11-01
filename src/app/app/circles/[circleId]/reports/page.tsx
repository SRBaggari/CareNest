import { Download, FileText, HeartPulse, MessageSquareText, Pill } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LineChart, type ChartPoint } from "@/components/ui/line-chart";
import { PageHeader } from "@/components/ui/page-header";
import { Badge, SectionCard } from "@/components/ui/section";
import { getRequestTranslator } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/lib/format";
import { chartValue, formatReading, MEASUREMENT_KINDS } from "@/server/domain/measurements";
import { MAX_REPORT_DAYS } from "@/server/domain/reports";
import { addDays, localDateIn } from "@/server/domain/schedule";
import { AppError } from "@/server/http";
import { orForbidden, orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { doctorSummary } from "@/server/services/reports";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Reports" };

/** A local date shown as a date, without shifting it through a time zone. */
const dateOnly = (date: string, locale: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export default async function ReportsPage({ params, searchParams }: PageProps<"/app/circles/[circleId]/reports">) {
  const { circleId } = await params;
  const { ctx } = await pageContext(`/app/circles/${circleId}/reports`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const p = circle.profile;
  const name = p.preferredName ?? p.displayName;
  const sp = await searchParams;
  const query = { from: typeof sp.from === "string" ? sp.from : undefined, to: typeof sp.to === "string" ? sp.to : undefined };

  // A period that can't be reported (future, backwards, too long) falls back to the default one, with a message.
  const result = await orForbidden(
    doctorSummary(ctx, circleId, query).then(
      (report) => ({ report, invalid: false }),
      async (err) => {
        if (!(err instanceof AppError && err.code === "validation_failed")) throw err;
        return { report: await doctorSummary(ctx, circleId, {}), invalid: true };
      },
    ),
  );
  if (!result) return <Alert>{t("reports.notShared", { name })}</Alert>;
  const { report, invalid } = result;

  const { from, to } = report.period;
  const today = localDateIn(p.timeZone, ctx.now);
  const base = `/app/circles/${circleId}/reports`;
  const range = (days: number) => `${base}?from=${addDays(today, -(days - 1))}&to=${today}`;
  const when = (d: Date) => formatDateTime(d, locale, p.timeZone);
  const shortDate = (d: Date) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: p.timeZone }).format(d);
  const canCsv = circle.myCapabilities.includes("health.view");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-6 print:hidden">
        <PageHeader title={t("reports.title")} description={t("reports.intro", { name })}>
          <PrintButton label={t("reports.print")} />
          {canCsv && (
            <a href={`/api/v1/circles/${circleId}/reports/measurements?from=${from}&to=${to}`} download className={buttonClass("secondary")}>
              <Download aria-hidden="true" className="size-5" />
              {t("reports.downloadCsv")}
            </a>
          )}
        </PageHeader>

        {invalid && <Alert tone="error">{t("reports.invalidPeriod", { max: MAX_REPORT_DAYS })}</Alert>}

        <form method="get" action={base} className="card flex flex-col gap-4">
          <fieldset className="flex flex-wrap items-end gap-3">
            <legend className="mb-2 font-semibold">{t("reports.period")}</legend>
            <label className="flex flex-col gap-1">
              <span>{t("reports.from")}</span>
              <input type="date" name="from" defaultValue={from} max={today} required className="min-h-12 rounded-xl border-2 border-border bg-surface px-3 text-lg focus:border-primary" />
            </label>
            <label className="flex flex-col gap-1">
              <span>{t("reports.to")}</span>
              <input type="date" name="to" defaultValue={to} max={today} required className="min-h-12 rounded-xl border-2 border-border bg-surface px-3 text-lg focus:border-primary" />
            </label>
            <button type="submit" className={buttonClass("secondary")}>
              {t("reports.show")}
            </button>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            {([7, 30, 90] as const).map((days) => (
              <Link key={days} href={range(days)} className="inline-flex min-h-11 items-center rounded-full bg-surface px-4 font-semibold text-muted ring-1 ring-border hover:text-foreground">
                {t(`reports.last${days}`)}
              </Link>
            ))}
          </div>
        </form>
      </div>

      <article aria-labelledby="report-title" className="flex flex-col gap-6">
        <header className="card flex flex-col gap-1 print:border-0 print:p-0 print:shadow-none">
          <h2 id="report-title" className="text-2xl font-bold sm:text-3xl">
            {t("reports.summaryFor", { name: p.displayName })}
          </h2>
          <p className="text-lg font-semibold">{t("reports.periodLine", { from: dateOnly(from, locale), to: dateOnly(to, locale) })}</p>
          {report.recipient.dateOfBirth && <p>{t("reports.born", { date: dateOnly(report.recipient.dateOfBirth, locale) })}</p>}
          <p className="mt-2 text-base text-muted">{t("reports.prepared", { name: report.generatedBy ?? t("audit.someone"), date: formatDate(report.generatedAt, locale, p.timeZone) })}</p>
        </header>

        {report.medicines && (
          <SectionCard id="report-medicines" icon={Pill} title={t("reports.medicinesTitle")} className="print:break-inside-auto">
            {report.medicines.length === 0 ? (
              <EmptyState icon={Pill}>{t("reports.nothing")}</EmptyState>
            ) : (
              <>
                <ul className="flex flex-col divide-y divide-border">
                  {report.medicines.map((m) => {
                    const counts = [
                      [t("reports.scheduled"), m.doses.scheduled],
                      [t("reports.takenOrGiven"), m.doses.taken + m.doses.administered],
                      [t("meds.status_skipped"), m.doses.skipped],
                      [t("meds.status_refused"), m.doses.refused],
                      [t("meds.status_unconfirmed"), m.doses.unconfirmed],
                    ] as const;
                    return (
                      <li key={m.id} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 print:break-inside-avoid">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <h4 className="text-lg font-bold">{m.name}</h4>
                          <span className="font-semibold">{m.dosage}</span>
                          {m.status === "stopped" && m.stoppedAt && <Badge tone="neutral">{t("meds.stoppedOn", { date: formatDate(m.stoppedAt, locale, p.timeZone) })}</Badge>}
                        </div>
                        <p className="text-muted">
                          {[m.asNeeded ? t("meds.asNeeded") : m.scheduleTimes.join(", "), t("reports.since", { date: dateOnly(m.startDate, locale) }), m.prescriber && t("reports.prescriber", { name: m.prescriber }), m.instructions]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {m.asNeeded ? (
                          <p className="font-semibold">{t("reports.asNeededCount", { count: m.doses.asNeeded })}</p>
                        ) : (
                          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                            {counts.map(([label, value]) => (
                              <div key={label} className="rounded-xl bg-sunken/70 px-3 py-2">
                                <dt className="text-base text-muted">{label}</dt>
                                <dd className="text-xl font-bold">{value}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="text-base text-muted">{t("reports.unconfirmedNote")}</p>
              </>
            )}
          </SectionCard>
        )}

        {report.readings && (
          <SectionCard id="report-readings" icon={HeartPulse} title={t("reports.readingsTitle")} className="print:break-inside-auto">
            {report.readings.length === 0 ? (
              <EmptyState icon={HeartPulse}>{t("reports.nothing")}</EmptyState>
            ) : (
              MEASUREMENT_KINDS.map((kind) => {
                const rows = report.readings!.filter((r) => r.kind === kind);
                if (rows.length === 0) return null;
                const counts = new Map<string, number>();
                for (const r of rows) counts.set(r.unit, (counts.get(r.unit) ?? 0) + 1);
                const unit = [...counts].sort((a, b) => b[1] - a[1])[0][0];
                const fmt = (r: (typeof rows)[number]) => formatReading(kind, r.unit, r.value, r.value2, locale) + (r.context ? ` · ${t(`health.ctx_${r.context}`)}` : "");
                const bp = kind === "blood_pressure";
                const points: ChartPoint[] = rows.map((r) => ({ at: r.measuredAt.getTime(), values: bp ? [chartValue(kind, unit, r.value), r.value2] : [chartValue(kind, unit, r.value)], label: fmt(r), when: shortDate(r.measuredAt) }));
                return (
                  <section key={kind} aria-labelledby={`r-${kind}`} className="flex flex-col gap-3 print:break-inside-avoid">
                    <h4 id={`r-${kind}`} className="text-lg font-bold">
                      {t(`health.kind_${kind}`)} <span className="font-normal text-muted">· {t("reports.readingCount", { count: rows.length })}</span>
                    </h4>
                    {points.length >= 2 && (
                      <LineChart
                        points={points}
                        series={bp ? [{ name: t("health.upper") }, { name: t("health.lower") }] : [{ name: t(`health.kind_${kind}`) }]}
                        title={t("health.chartTitle", { kind: t(`health.kind_${kind}`) })}
                        labels={{ showTable: t("health.showTable"), date: t("health.date") }}
                      />
                    )}
                    <ul className="flex flex-col divide-y divide-border">
                      {rows.map((r) => (
                        <li key={r.id} className="flex flex-wrap justify-between gap-x-4 py-2">
                          <span className="font-semibold">{fmt(r)}</span>
                          <span className="text-base text-muted">
                            {when(r.measuredAt)} · {t("health.recordedBy", { name: r.recordedBy?.name ?? t("audit.someone") })}
                          </span>
                          {r.note && <span className="w-full text-base">{r.note}</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })
            )}
          </SectionCard>
        )}

        {report.notes && (
          <SectionCard id="report-notes" icon={MessageSquareText} title={t("reports.notesTitle")} className="print:break-inside-auto">
            {report.notes.length === 0 ? (
              <EmptyState icon={FileText}>{t("reports.nothing")}</EmptyState>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {report.notes.map((n) => (
                  <li key={n.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 print:break-inside-avoid">
                    <span className="flex flex-wrap items-center gap-2 text-base text-muted">
                      <span className="font-semibold text-foreground">{n.author?.name ?? t("audit.someone")}</span>
                      {when(n.createdAt)}
                      {n.category !== "general" && <Badge tone="neutral">{t(`updates.category_${n.category}`)}</Badge>}
                    </span>
                    <p className="whitespace-pre-line">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}
      </article>
    </div>
  );
}
