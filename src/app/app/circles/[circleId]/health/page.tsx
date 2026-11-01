import { Frown, HandHelping, HeartPulse, Minus, Smile } from "lucide-react";
import type { Metadata } from "next";
import { ActionButton } from "@/components/action-button";
import { Alert } from "@/components/ui/alert";
import { LineChart, type ChartPoint } from "@/components/ui/line-chart";
import { SectionCard } from "@/components/ui/section";
import { getRequestTranslator } from "@/i18n/server";
import { formatDateTime } from "@/lib/format";
import { chartValue, formatReading, MEASUREMENT_KINDS, SUGAR_CONTEXTS, unitsFor, type MeasurementKind } from "@/server/domain/measurements";
import { addDays, localDateIn } from "@/server/domain/schedule";
import { orForbidden, orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { listCheckins, listMeasurements } from "@/server/services/measurements";
import { RecordReadingForm } from "./health-forms";

export const metadata: Metadata = { title: "Health" };

/** What families in a country usually read off their devices. */
function defaultUnits(country: string): Record<MeasurementKind, string> {
  const mmol = ["GB", "IE", "CA", "AU", "NZ", "ZA"].includes(country);
  const imperial = country === "US";
  return {
    blood_pressure: "mmHg",
    blood_sugar: mmol ? "mmol/L" : "mg/dL",
    weight: imperial ? "lb" : "kg",
    temperature: imperial || country === "IN" ? "°F" : "°C",
    pulse: "bpm",
    oxygen: "%",
  };
}

const FEELING = { fine: { Icon: Smile, tone: "bg-success-soft text-success" }, unwell: { Icon: Frown, tone: "bg-warning-soft text-warning" }, need: { Icon: HandHelping, tone: "bg-primary-soft text-primary" } };

export default async function HealthPage({ params }: PageProps<"/app/circles/[circleId]/health">) {
  const { circleId } = await params;
  const { session, ctx } = await pageContext(`/app/circles/${circleId}/health`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const p = circle.profile;
  const name = p.preferredName ?? p.displayName;
  const readings = await orForbidden(listMeasurements(ctx, circleId, { days: 90 }));
  if (!readings) return <Alert>{t("health.notShared", { name })}</Alert>;
  const checkins = await listCheckins(ctx, circleId, 14);
  const caps = new Set(circle.myCapabilities);
  const canRecord = caps.has("measurement.record") && circle.status === "active";
  const isAdmin = circle.myMembership.role === "admin";
  const messages = { network: t("common.errorNetwork"), generic: t("common.errorGeneric"), fixErrors: t("common.fixErrors") };
  const when = (d: Date) => formatDateTime(d, locale, p.timeZone);
  const shortDate = (d: Date) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: p.timeZone }).format(d);

  // Last 14 local days, oldest first, with that day's answer (if any).
  const today = localDateIn(p.timeZone, ctx.now);
  const byDay = new Map(checkins.map((c) => [c.date, c.feeling]));
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const weekday = (date: string) => new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const fullDay = (date: string) => new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold">{t("health.title")}</h2>
        <p className="text-muted">{t("health.intro", { name })}</p>
        <Alert>{t("health.notMedical", { number: p.emergencyNumber })}</Alert>
      </div>

      <SectionCard id="checkins-heading" icon={Smile} title={t("health.checkinsTitle", { name })}>
        <p className="text-muted">{t("health.checkinHint", { name })}</p>
        {checkins.length === 0 ? (
          <p>{t("health.checkinsNone", { name })}</p>
        ) : (
          <ol className="grid grid-cols-7 gap-2 sm:grid-cols-14">
            {days.map((date) => {
              const feeling = byDay.get(date);
              const look = feeling ? FEELING[feeling] : { Icon: Minus, tone: "bg-sunken text-muted" };
              return (
                <li key={date} className="flex flex-col items-center gap-1">
                  <span className="text-sm text-muted" aria-hidden="true">
                    {weekday(date)}
                  </span>
                  <span className={`inline-flex size-10 items-center justify-center rounded-full ${look.tone}`}>
                    <look.Icon aria-hidden="true" className="size-6" />
                    <span className="sr-only">
                      {fullDay(date)}: {t(`health.feel_${feeling ?? "none"}`)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </SectionCard>

      {canRecord && (
        <SectionCard id="record-heading" icon={HeartPulse} title={t("health.record")}>
          <RecordReadingForm
            url={`/api/v1/circles/${circleId}/measurements`}
            timeZone={p.timeZone}
            kinds={MEASUREMENT_KINDS.map((k) => ({ value: k, label: t(`health.kind_${k}`) }))}
            units={Object.fromEntries(MEASUREMENT_KINDS.map((k) => [k, unitsFor(k)])) as Record<MeasurementKind, string[]>}
            defaultUnits={defaultUnits(p.country)}
            contexts={SUGAR_CONTEXTS.map((c) => ({ value: c, label: t(`health.ctx_${c}`) }))}
            labels={{
              ...messages,
              ...(Object.fromEntries((["kind", "value", "valueBp", "value2Bp", "unit", "context", "note", "save", "saved"] as const).map((k) => [k, t(`health.${k}`)])) as Record<string, string>),
              measuredAt: t("health.measuredAt", { name, zone: p.timeZone }),
            } as Parameters<typeof RecordReadingForm>[0]["labels"]}
          />
        </SectionCard>
      )}

      {readings.length === 0 && <p className="text-muted">{t("health.none")}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        {MEASUREMENT_KINDS.map((kind) => {
          const rows = readings.filter((r) => r.kind === kind);
          if (rows.length === 0) return null;
          const latest = rows[0];
          // One scale per chart: plot in the unit most of these readings were entered in.
          const counts = new Map<string, number>();
          for (const r of rows) counts.set(r.unit, (counts.get(r.unit) ?? 0) + 1);
          const unit = [...counts].sort((a, b) => b[1] - a[1])[0][0];
          const fmt = (r: (typeof rows)[number]) =>
            formatReading(kind, r.unit, r.value, r.value2, locale) + (r.context ? ` · ${t(`health.ctx_${r.context}`)}` : "");
          const points: ChartPoint[] = [...rows].reverse().map((r) => ({
            at: r.measuredAt.getTime(),
            values: [chartValue(kind, unit, r.value), r.value2],
            label: fmt(r),
            when: shortDate(r.measuredAt),
          }));
          const bp = kind === "blood_pressure";
          return (
            <SectionCard key={kind} id={`kind-${kind}`} icon={HeartPulse} title={t(`health.kind_${kind}`)}>
              <div>
                <p className="text-muted">{t("health.latest")}</p>
                <p className="text-3xl font-bold">{formatReading(kind, latest.unit, latest.value, latest.value2, locale)}</p>
                <p className="text-muted">
                  {when(latest.measuredAt)} · {t("health.recordedBy", { name: latest.recordedBy?.name ?? t("audit.someone") })}
                </p>
              </div>
              {points.length >= 2 && (
                <LineChart
                  points={points.map((pt) => (bp ? pt : { ...pt, values: [pt.values[0]] }))}
                  series={bp ? [{ name: t("health.upper") }, { name: t("health.lower") }] : [{ name: t(`health.kind_${kind}`) }]}
                  title={t("health.chartTitle", { kind: t(`health.kind_${kind}`) })}
                  labels={{ showTable: t("health.showTable"), date: t("health.date") }}
                />
              )}
              <div>
                <h4 className="font-bold">{t("health.recent")}</h4>
                <ul className="mt-2 flex flex-col divide-y divide-border">
                  {rows.slice(0, 5).map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        <span className="block font-semibold">{fmt(r)}</span>
                        <span className="text-base text-muted">
                          {when(r.measuredAt)} · {t("health.recordedBy", { name: r.recordedBy?.name ?? t("audit.someone") })}
                        </span>
                        {r.note && <span className="block text-base">{r.note}</span>}
                      </span>
                      {canRecord && (r.recordedBy?.id === session.user.id || isAdmin) && (
                        <ActionButton
                          method="DELETE"
                          url={`/api/v1/circles/${circleId}/measurements/${r.id}`}
                          confirm={t("health.removeConfirm")}
                          variant="quietDanger"
                          className="px-3 text-base"
                          messages={messages}
                        >
                          {t("health.remove")}
                        </ActionButton>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </SectionCard>
          );
        })}
      </div>
    </div>
  );
}
