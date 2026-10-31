import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { Alert } from "@/components/ui/alert";
import { getRequestTranslator } from "@/i18n/server";
import { displayStatus, formatClock, STATUS_SYMBOL, STATUS_TONE } from "@/lib/dose-display";
import { formatDate } from "@/lib/format";
import { daysOfSupply } from "@/server/domain/doses";
import { addDays, LOCAL_DATE_PATTERN } from "@/server/domain/schedule";
import { orForbidden, orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { listDoses } from "@/server/services/doses";
import { listMedications } from "@/server/services/medications";
import { acknowledgementsFor } from "@/server/services/notifications";
import { AsNeededForm, DoseActions, MedicationForm, RestockForm } from "./medicine-forms";

export const metadata: Metadata = { title: "Medicines" };

const toneClass = {
  success: "border-success text-success",
  warning: "border-warning text-warning",
  info: "border-primary text-primary",
  neutral: "border-border text-muted",
};

export default async function MedicinesPage({ params, searchParams }: PageProps<"/app/circles/[circleId]/medicines">) {
  const { circleId } = await params;
  const dateParam = (await searchParams).date;
  const date = typeof dateParam === "string" && LOCAL_DATE_PATTERN.test(dateParam) ? dateParam : undefined;
  const { session, ctx } = await pageContext(`/app/circles/${circleId}/medicines`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const name = circle.profile.preferredName ?? circle.profile.displayName;

  const day = await orForbidden(listDoses(ctx, circleId, { date, days: 1 }));
  if (!day) return <Alert>{t("meds.notShared", { name })}</Alert>;
  const meds = await listMedications(ctx, circleId, { includeStopped: true });
  const checking = await acknowledgementsFor(
    ctx.db,
    day.doses.filter((d) => d.status === "unconfirmed").map((d) => `dose:${d.id}`),
  );

  const caps = new Set(circle.myCapabilities);
  const active = circle.status === "active";
  const canRecord = caps.has("dose.record") && active;
  const canManage = caps.has("medication.manage") && active;
  const isRecipient = circle.myMembership.role === "care_recipient";
  const canAdminister = !isRecipient;
  const viewerTz = session.user.timeZone;
  const sameZone = viewerTz === day.timeZone;
  const messages = { network: t("common.errorNetwork"), generic: t("common.errorGeneric"), fixErrors: t("common.fixErrors") };
  const base = `/app/circles/${circleId}/medicines`;
  const dayLabel = formatDate(`${day.fromDate}T12:00:00Z`, locale, "UTC");

  const actionLabels = {
    ...messages,
    taken: isRecipient ? t("meds.iTookIt") : t("meds.markTaken"),
    administered: t("meds.markGiven"),
    skipped: isRecipient ? t("meds.iSkipped") : t("meds.markSkipped"),
    refused: isRecipient ? t("meds.iRefused") : t("meds.markRefused"),
    change: t("meds.change"),
    reason: t("meds.reason"),
    note: t("meds.note"),
    sideEffects: t("meds.sideEffects"),
    confirm: t("meds.confirm"),
    cancel: t("common.cancel"),
  };

  const activeMeds = meds.filter((m) => m.status === "active");
  const stoppedMeds = meds.filter((m) => m.status === "stopped");
  const asNeeded = activeMeds.filter((m) => m.asNeeded);
  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: d, label: t(`meds.weekday_${d}`) }));
  const formLabels = Object.fromEntries(
    [
      "formIntro", "name", "dosage", "dosageHint", "instructions", "instructionsHint", "prescriberField", "startDate", "endDate",
      "asNeededField", "times", "addTime", "removeTime", "days", "unitsPerDose", "supplyCount", "refillThreshold", "save", "everyDay",
    ].map((k) => [k, t(`meds.${k}`)]),
  ) as Record<string, string>;

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="doses-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="doses-heading" className="text-2xl font-semibold">
            {t("meds.dayTitle", { date: dayLabel })}
          </h2>
          <nav aria-label={t("meds.dayTitle", { date: dayLabel })} className="flex flex-wrap gap-2">
            <Link href={`${base}?date=${addDays(day.fromDate, -1)}`} className="inline-flex min-h-12 items-center rounded-lg border-2 border-border px-4 font-medium">
              ← {t("meds.previousDay")}
            </Link>
            <Link href={base} className="inline-flex min-h-12 items-center rounded-lg border-2 border-border px-4 font-medium">
              {t("meds.today")}
            </Link>
            <Link href={`${base}?date=${addDays(day.fromDate, 1)}`} className="inline-flex min-h-12 items-center rounded-lg border-2 border-border px-4 font-medium">
              {t("meds.nextDay")} →
            </Link>
          </nav>
        </div>

        {day.doses.length === 0 ? (
          <p className="text-muted">{t("meds.noDoses")}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {day.doses.map((dose) => {
              const shown = displayStatus(dose, ctx.now);
              const at = dose.scheduledFor ?? dose.occurredAt!;
              const recorder = dose.recordedBy?.name ?? t("audit.someone");
              const recorded = dose.status !== "scheduled" && dose.status !== "unconfirmed";
              return (
                <li key={dose.id} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xl font-semibold">
                        <time dateTime={new Date(at).toISOString()}>{formatClock(at, locale, day.timeZone)}</time>
                        {" · "}
                        {dose.medication.name}
                      </p>
                      <p>{dose.medication.dosage}</p>
                      {dose.medication.instructions && <p className="text-muted">{dose.medication.instructions}</p>}
                      {!sameZone && (
                        <p className="text-muted">
                          {t("meds.theirTime", { time: formatClock(at, locale, day.timeZone) })} ·{" "}
                          {t("meds.yourTime", { time: formatClock(at, locale, viewerTz) })}
                        </p>
                      )}
                      {dose.shifted && dose.localTime && <p className="text-warning">{t("meds.shifted", { time: dose.localTime })}</p>}
                    </div>
                    <span className={`inline-flex items-center gap-2 rounded-full border-2 px-3 py-1 font-semibold ${toneClass[STATUS_TONE[shown]]}`}>
                      <span aria-hidden="true">{STATUS_SYMBOL[shown]}</span>
                      {t(`meds.status_${shown}`)}
                    </span>
                  </div>

                  {shown === "unconfirmed" && <p className="text-warning">{t("meds.unconfirmedHelp", { name })}</p>}
                  {shown === "unconfirmed" && (checking.get(`dose:${dose.id}`)?.length ?? 0) > 0 && (
                    <p className="font-medium">
                      {t("meds.checking", { names: checking.get(`dose:${dose.id}`)!.map((a) => a.name).join(", ") })}
                    </p>
                  )}
                  {recorded && dose.source && (
                    <p className="text-muted">
                      {t(`meds.source_${dose.source}`, { name: recorder })}
                      {dose.occurredAt && ` ${t("meds.at", { time: formatClock(dose.occurredAt, locale, day.timeZone) })}`}
                      {dose.recordedAt && dose.occurredAt && Math.abs(new Date(dose.recordedAt).getTime() - new Date(dose.occurredAt).getTime()) > 30 * 60_000 &&
                        ` ${t("meds.recordedLate", { time: formatClock(dose.recordedAt, locale, day.timeZone) })}`}
                    </p>
                  )}
                  {dose.reason && <p>{t("meds.reason")}: {dose.reason}</p>}
                  {dose.note && <p>{t("meds.note")}: {dose.note}</p>}
                  {dose.sideEffects && <p>{t("meds.sideEffects")}: {dose.sideEffects}</p>}

                  {canRecord && dose.medication.status === "active" && (
                    <DoseActions
                      url={`/api/v1/circles/${circleId}/doses/${dose.id}/record`}
                      recorded={recorded}
                      canAdminister={canAdminister}
                      labels={actionLabels}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {asNeeded.length > 0 && canRecord && (
        <section aria-labelledby="prn-heading" className="flex flex-col gap-3">
          <h2 id="prn-heading" className="text-2xl font-semibold">
            {t("meds.asNeededTitle")}
          </h2>
          <ul className="flex flex-col gap-3">
            {asNeeded.map((m) => (
              <li key={m.id} className="rounded-xl border border-border bg-surface p-5">
                <p className="text-lg font-semibold">
                  {m.name} · {m.dosage}
                </p>
                <AsNeededForm
                  url={`/api/v1/circles/${circleId}/medications/${m.id}/doses`}
                  canAdminister={canAdminister}
                  labels={{ ...actionLabels, open: t("meds.recordAsNeeded"), when: t("meds.whenTaken") }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="list-heading" className="flex flex-col gap-3">
        <h2 id="list-heading" className="text-2xl font-semibold">
          {t("meds.listTitle")}
        </h2>
        {activeMeds.length === 0 && <p className="text-muted">{t("meds.noMedicines")}</p>}
        <ul className="flex flex-col gap-3">
          {activeMeds.map((m) => {
            const left = daysOfSupply(m.supplyCount, (m.daysOfWeek ? m.daysOfWeek.length / 7 : 1) * m.times.length, m.unitsPerDose);
            return (
              <li key={m.id} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
                <p className="text-lg font-semibold">
                  {m.name} · {m.dosage}
                </p>
                <p>
                  {m.asNeeded
                    ? t("meds.asNeeded")
                    : `${m.times.join(", ")} · ${m.daysOfWeek ? m.daysOfWeek.map((d) => t(`meds.weekday_${d}`)).join(", ") : t("meds.everyDay")}`}
                </p>
                {m.instructions && <p className="text-muted">{m.instructions}</p>}
                {m.prescriber && <p className="text-muted">{t("meds.prescriber", { name: m.prescriber })}</p>}
                {m.supplyCount !== null && (
                  <p>
                    {t("meds.supply", { count: m.supplyCount })}
                    {left !== null && !m.asNeeded && ` (${t("meds.supplyDays", { days: left })})`}
                  </p>
                )}
                {m.needsRefill && <Alert tone="error">{t("meds.lowSupply")}</Alert>}
                <div className="flex flex-wrap items-start gap-3">
                  {canRecord && (
                    <RestockForm
                      url={`/api/v1/circles/${circleId}/medications/${m.id}/restock`}
                      current={m.supplyCount}
                      labels={{ ...messages, open: t("meds.restock"), count: t("meds.stockCount"), save: t("common.save"), cancel: t("common.cancel") }}
                    />
                  )}
                  {canManage && (
                    <>
                      <MedicationForm
                        method="PATCH"
                        url={`/api/v1/circles/${circleId}/medications/${m.id}`}
                        initial={m}
                        weekdays={weekdays}
                        openLabel={t("meds.edit")}
                        labels={{ ...messages, ...formLabels, cancel: t("common.cancel") }}
                      />
                      <ActionButton
                        method="POST"
                        url={`/api/v1/circles/${circleId}/medications/${m.id}/stop`}
                        body={{}}
                        confirm={t("meds.stopConfirm")}
                        variant="danger"
                        messages={messages}
                      >
                        {t("meds.stop")}
                      </ActionButton>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {canManage && (
          <MedicationForm
            method="POST"
            url={`/api/v1/circles/${circleId}/medications`}
            weekdays={weekdays}
            openLabel={t("meds.add")}
            labels={{ ...messages, ...formLabels, cancel: t("common.cancel") }}
          />
        )}
      </section>

      {stoppedMeds.length > 0 && (
        <details className="rounded-xl border border-border bg-surface p-5">
          <summary className="min-h-12 cursor-pointer text-lg font-semibold">{t("meds.stoppedTitle", { count: stoppedMeds.length })}</summary>
          <ul className="mt-3 flex flex-col gap-2">
            {stoppedMeds.map((m) => (
              <li key={m.id}>
                <span className="font-medium">
                  {m.name} · {m.dosage}
                </span>{" "}
                <span className="text-muted">
                  {m.stoppedAt && t("meds.stoppedOn", { date: formatDate(m.stoppedAt, locale, viewerTz) })}
                  {m.stopReason && ` — ${m.stopReason}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
