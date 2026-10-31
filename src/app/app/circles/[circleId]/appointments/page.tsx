import type { Metadata } from "next";
import { ActionButton } from "@/components/action-button";
import { Alert } from "@/components/ui/alert";
import { getRequestTranslator } from "@/i18n/server";
import { formatDateTime } from "@/lib/format";
import { orForbidden, orNotFound, pageContext } from "@/server/page";
import { listAppointments } from "@/server/services/appointments";
import { getCircle } from "@/server/services/circles";
import { HELPER_ROLES } from "@/server/services/members";
import { AppointmentForm, OutcomeForm } from "./appointment-forms";

export const metadata: Metadata = { title: "Appointments" };

type Appointment = Awaited<ReturnType<typeof listAppointments>>[number];

export default async function AppointmentsPage({ params }: PageProps<"/app/circles/[circleId]/appointments">) {
  const { circleId } = await params;
  const { session, ctx } = await pageContext(`/app/circles/${circleId}/appointments`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const name = circle.profile.preferredName ?? circle.profile.displayName;
  const zone = circle.profile.timeZone;

  const upcoming = await orForbidden(listAppointments(ctx, circleId, { range: "upcoming" }));
  if (!upcoming) return <Alert>{t("common.notAllowed")}</Alert>;
  const past = await listAppointments(ctx, circleId, { range: "past", limit: 20 });

  const caps = new Set(circle.myCapabilities);
  const active = circle.status === "active";
  const canManage = caps.has("appointment.manage") && active;
  const me = circle.myMembership;
  const canHelp = HELPER_ROLES.includes(me.role) && active;
  const viewerZone = session.user.timeZone;
  const messages = { network: t("common.errorNetwork"), generic: t("common.errorGeneric"), fixErrors: t("common.fixErrors") };
  const base = `/api/v1/circles/${circleId}/appointments`;

  const formLabels = {
    ...messages,
    ...Object.fromEntries(
      ["title", "titleHint", "kind", "kind_in_person", "kind_virtual", "kind_home_visit", "clinician", "location", "virtualUrl", "endsAt", "reason", "questions", "questionsHint", "save"].map(
        (k) => [k, t(`appts.${k}`)],
      ),
    ),
    startsAt: t("appts.startsAt", { name, zone }),
    transportNeeded: t("appts.transportNeeded", { name }),
    cancel: t("common.cancel"),
  };

  const when = (a: Appointment) => (
    <p className="text-lg">
      <time dateTime={a.startsAt.toISOString()}>{t("appts.theirTime", { time: formatDateTime(a.startsAt, locale, zone), name })}</time>
      {viewerZone !== zone && <span className="block text-muted">{t("appts.yourTime", { time: formatDateTime(a.startsAt, locale, viewerZone) })}</span>}
    </p>
  );

  const helperRow = (a: Appointment, role: "transport" | "companion") => {
    const who = role === "transport" ? a.transport : a.companion;
    const mine = who?.memberId === me.id;
    const label = who
      ? t(role === "transport" ? "appts.driving" : "appts.goingAlong", { name: who.name ?? "" })
      : t(role === "transport" ? "appts.noDriver" : "appts.noCompanion");
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className={who ? "font-medium" : "font-semibold text-warning"}>
          {!who && <span aria-hidden="true">! </span>}
          {label}
        </span>
        {a.status === "scheduled" && canHelp && (!who || mine) && (
          <ActionButton method="PUT" url={`${base}/${a.id}/helpers`} body={{ role, memberId: mine ? null : me.id }} variant={mine ? "secondary" : "primary"} messages={messages}>
            {mine ? t(role === "transport" ? "appts.cantDrive" : "appts.cantGo") : t(role === "transport" ? "appts.illDrive" : "appts.illGo")}
          </ActionButton>
        )}
      </div>
    );
  };

  const details = (a: Appointment) => (
    <>
      <p className="text-muted">{t(`appts.kind_${a.kind}`)}</p>
      {a.clinician && <p>{a.clinician}</p>}
      {a.location && <p className="text-muted">{a.location}</p>}
      {a.virtualUrl && (
        <a href={a.virtualUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">
          {t("appts.openLink")}
        </a>
      )}
      {a.reason && <p>{a.reason}</p>}
      {a.questions && (
        <div className="rounded-lg bg-background p-3">
          <p className="font-semibold">{t("appts.questions")}</p>
          <p className="whitespace-pre-line">{a.questions}</p>
        </div>
      )}
    </>
  );

  const outcome = (a: Appointment) =>
    a.outcome && (
      <div className="rounded-lg border-l-4 border-success bg-background p-3">
        {a.outcome.note && <p className="whitespace-pre-line">{a.outcome.note}</p>}
        {a.outcome.followUp && <p className="mt-2 whitespace-pre-line">{a.outcome.followUp}</p>}
        <p className="mt-2 text-muted">
          {t("appts.summaryBy", { name: a.outcome.by ?? t("audit.someone"), date: formatDateTime(a.outcome.at, locale, viewerZone) })}
        </p>
        <p className="text-muted">{t("appts.summaryCaveat")}</p>
      </div>
    );

  const canRecord = (a: Appointment) =>
    active && a.status !== "cancelled" && a.startsAt.getTime() <= ctx.now.getTime() && (canManage || a.transport?.memberId === me.id || a.companion?.memberId === me.id);

  const outcomeLabels = {
    ...messages,
    open: t("appts.recordOutcome"),
    outcomeNote: t("appts.outcomeNote"),
    followUp: t("appts.followUp"),
    followUpTasks: t("appts.followUpTasks"),
    followUpTasksHint: t("appts.followUpTasksHint"),
    save: t("appts.saveOutcome"),
    cancel: t("common.cancel"),
  };

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="upcoming-heading" className="flex flex-col gap-4">
        <h2 id="upcoming-heading" className="text-2xl font-semibold">
          {t("appts.upcoming")}
        </h2>
        {upcoming.length === 0 && <p className="text-muted">{t("appts.none")}</p>}
        <ol className="flex flex-col gap-4">
          {upcoming.map((a) => (
            <li key={a.id} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xl font-semibold">{a.title}</h3>
                {a.status !== "scheduled" && <span className="font-semibold text-muted">{t(`appts.status_${a.status}`)}</span>}
              </div>
              {when(a)}
              {details(a)}
              {a.status === "cancelled" && a.cancelReason && <p className="text-warning">{t("appts.cancelledReason", { reason: a.cancelReason })}</p>}
              {a.transportNeeded && a.status === "scheduled" && (
                <div className="flex flex-col gap-2">
                  {helperRow(a, "transport")}
                  <p className="text-muted">{t("appts.notBooked", { name })}</p>
                </div>
              )}
              {a.status === "scheduled" && helperRow(a, "companion")}
              {outcome(a)}
              <div className="flex flex-wrap items-start gap-3">
                {canRecord(a) && a.status === "scheduled" && <OutcomeForm url={`${base}/${a.id}/complete`} labels={outcomeLabels} />}
                {canManage && a.status === "scheduled" && (
                  <>
                    <AppointmentForm method="PATCH" url={`${base}/${a.id}`} timeZone={zone} initial={a} openLabel={t("appts.edit")} labels={formLabels} />
                    <ActionButton method="POST" url={`${base}/${a.id}/cancel`} body={{}} confirm={t("appts.cancelConfirm")} variant="danger" messages={messages}>
                      {t("appts.cancel")}
                    </ActionButton>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
        {canManage && <AppointmentForm method="POST" url={base} timeZone={zone} openLabel={t("appts.add")} labels={formLabels} />}
      </section>

      <section aria-labelledby="past-heading" className="flex flex-col gap-4">
        <h2 id="past-heading" className="text-2xl font-semibold">
          {t("appts.past")}
        </h2>
        {past.length === 0 && <p className="text-muted">{t("appts.nonePast")}</p>}
        <ol className="flex flex-col gap-3">
          {past.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg font-semibold">{a.title}</h3>
                {a.status !== "scheduled" && <span className="font-semibold text-muted">{t(`appts.status_${a.status}`)}</span>}
              </div>
              {when(a)}
              {a.clinician && <p>{a.clinician}</p>}
              {outcome(a)}
              {canRecord(a) && a.status === "scheduled" && <OutcomeForm url={`${base}/${a.id}/complete`} labels={outcomeLabels} />}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
