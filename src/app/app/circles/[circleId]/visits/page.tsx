import type { Metadata } from "next";
import { ActionButton } from "@/components/action-button";
import { SimpleForm } from "@/components/simple-form";
import { Alert } from "@/components/ui/alert";
import { getRequestTranslator } from "@/i18n/server";
import { formatDateTime } from "@/lib/format";
import { orForbidden, orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { listMembers } from "@/server/services/members";
import { latestHandover, listVisits } from "@/server/services/visits";

export const metadata: Metadata = { title: "Visits" };

type Visit = Awaited<ReturnType<typeof listVisits>>[number];

export default async function VisitsPage({ params }: PageProps<"/app/circles/[circleId]/visits">) {
  const { circleId } = await params;
  const { session, ctx } = await pageContext(`/app/circles/${circleId}/visits`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const name = circle.profile.preferredName ?? circle.profile.displayName;
  const zone = circle.profile.timeZone;

  const upcoming = await orForbidden(listVisits(ctx, circleId, "upcoming"));
  if (!upcoming) return <Alert>{t("common.notAllowed")}</Alert>;
  const [recent, handover] = await Promise.all([listVisits(ctx, circleId, "recent"), latestHandover(ctx, circleId)]);

  const caps = new Set(circle.myCapabilities);
  const active = circle.status === "active";
  const me = circle.myMembership;
  const canRecord = caps.has("visit.record") && active;
  const canOrganise = canRecord && (me.role === "admin" || me.role === "family");
  const members = canOrganise ? await listMembers(ctx, circleId) : [];
  const messages = { network: t("common.errorNetwork"), generic: t("common.errorGeneric"), fixErrors: t("common.fixErrors") };
  const base = `/api/v1/circles/${circleId}/visits`;
  const fmt = (d: Date) => formatDateTime(d, locale, session.user.timeZone);
  const common = { messages, cancelLabel: t("common.cancel"), timeZone: zone };

  const details = (v: Visit) => (
    <>
      {v.detailsHidden && <p className="text-muted">{t("visits.detailsHidden", { name })}</p>}
      {v.observations && (
        <p>
          <span className="font-semibold">{t("visits.observationsLabel")}:</span> {v.observations}
        </p>
      )}
      {v.handoverNote && (
        <p>
          <span className="font-semibold">{t("visits.handoverLabel")}:</span> {v.handoverNote}
        </p>
      )}
      {v.unresolvedIssues && (
        <p className="font-medium text-warning">
          <span className="font-semibold">{t("visits.unresolvedLabel")}:</span> {v.unresolvedIssues}
        </p>
      )}
    </>
  );

  const card = (v: Visit) => {
    const mine = v.visitor?.memberId === me.id;
    const late = v.status === "planned" && v.plannedStart.getTime() < ctx.now.getTime();
    return (
      <li key={v.id} className="flex flex-col gap-2 card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-xl font-semibold">{v.visitor?.name ?? t("audit.someone")}</h3>
          <span className={`font-semibold ${late ? "text-warning" : "text-muted"}`}>{late ? t("visits.notChecked") : t(`visits.status_${v.status}`)}</span>
        </div>
        <p>{t("visits.planned", { when: fmt(v.plannedStart) })}</p>
        {v.purpose && <p className="text-muted">{v.purpose}</p>}
        {v.checkedInAt && <p>{t("visits.checkedIn", { when: fmt(v.checkedInAt) })}</p>}
        {v.checkedOutAt && <p>{t("visits.checkedOut", { when: fmt(v.checkedOutAt) })}</p>}
        {v.cancelReason && <p className="text-warning">{t("visits.cancelledReason", { reason: v.cancelReason })}</p>}
        {details(v)}
        {active && (
          <div className="flex flex-wrap items-start gap-3">
            {mine && v.status === "planned" && (
              <ActionButton method="POST" url={`${base}/${v.id}/check-in`} variant="primary" messages={messages}>
                {t("visits.arrived")}
              </ActionButton>
            )}
            {mine && v.status === "in_progress" && (
              <SimpleForm
                {...common}
                method="POST"
                url={`${base}/${v.id}/check-out`}
                openLabel={t("visits.finish")}
                submitLabel={t("visits.finish")}
                variant="primary"
                fields={[
                  { name: "observations", type: "textarea", label: t("visits.observations", { name }), maxLength: 4000 },
                  { name: "handoverNote", type: "textarea", label: t("visits.handoverNote"), maxLength: 4000 },
                  { name: "unresolvedIssues", type: "textarea", label: t("visits.unresolvedIssues"), maxLength: 2000 },
                ]}
              />
            )}
            {v.status === "planned" && (mine || canOrganise) && (
              <SimpleForm
                {...common}
                method="POST"
                url={`${base}/${v.id}/cancel`}
                openLabel={mine ? t("visits.cantMakeIt") : t("visits.cancel")}
                submitLabel={t("visits.confirm")}
                variant="danger"
                fields={[{ name: "reason", type: "text", label: t("visits.reason"), required: true, maxLength: 500 }]}
              />
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <p className="text-muted">{t("visits.selfReported")}</p>

      {handover && (
        <section aria-labelledby="handover-heading" className="rounded-xl border-l-8 border-primary bg-surface p-5">
          <h2 id="handover-heading" className="text-lg font-semibold">
            {t("visits.lastHandover", { name: handover.visitor?.name ?? t("audit.someone"), when: fmt(handover.checkedOutAt!) })}
          </h2>
          <p className="mt-2 whitespace-pre-line">{handover.handoverNote}</p>
          {handover.unresolvedIssues && <p className="mt-2 font-medium text-warning">{handover.unresolvedIssues}</p>}
        </section>
      )}

      {canRecord && (
        <div className="flex flex-wrap items-start gap-3">
          <ActionButton method="POST" url={base} body={{ startNow: true }} variant="primary" messages={messages}>
            {t("visits.startNow")}
          </ActionButton>
          <SimpleForm
            {...common}
            method="POST"
            url={base}
            openLabel={t("visits.plan")}
            submitLabel={t("visits.save")}
            fields={[
              ...(canOrganise
                ? [
                    {
                      name: "visitorMemberId",
                      type: "select" as const,
                      label: t("visits.visitor"),
                      defaultValue: me.id,
                      options: members.filter((m) => ["admin", "family", "caregiver"].includes(m.role)).map((m) => ({ value: m.id, label: m.name })),
                    },
                  ]
                : []),
              { name: "plannedStart", type: "zoned-datetime", label: t("visits.plannedStart", { name, zone }), required: true },
              { name: "plannedEnd", type: "zoned-datetime", label: t("visits.plannedEnd") },
              { name: "purpose", type: "text", label: t("visits.purpose"), maxLength: 500 },
            ]}
          />
        </div>
      )}

      <section aria-labelledby="upcoming-heading" className="flex flex-col gap-3">
        <h2 id="upcoming-heading" className="text-2xl font-semibold">
          {t("visits.upcoming")}
        </h2>
        {upcoming.length === 0 ? <p className="text-muted">{t("visits.none")}</p> : <ol className="flex flex-col gap-3">{upcoming.map(card)}</ol>}
      </section>

      <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
        <h2 id="recent-heading" className="text-2xl font-semibold">
          {t("visits.recent")}
        </h2>
        {recent.length === 0 ? <p className="text-muted">{t("visits.noneRecent")}</p> : <ol className="flex flex-col gap-3">{recent.map(card)}</ol>}
      </section>
    </div>
  );
}
