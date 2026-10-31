import type { Metadata } from "next";
import { ActionButton } from "@/components/action-button";
import { SimpleForm } from "@/components/simple-form";
import { getRequestTranslator } from "@/i18n/server";
import { formatDateTime } from "@/lib/format";
import { orNotFound, pageContext } from "@/server/page";
import { getAssistance } from "@/server/services/assistance";
import { getCircle } from "@/server/services/circles";
import { AutoRefresh } from "../help-button";

export const metadata: Metadata = { title: "Request for help" };

const statusClass = {
  open: "border-danger",
  acknowledged: "border-warning",
  resolved: "border-success",
  cancelled: "border-border",
};

export default async function AssistancePage({ params }: PageProps<"/app/circles/[circleId]/emergency/[requestId]">) {
  const { circleId, requestId } = await params;
  const { session, ctx } = await pageContext(`/app/circles/${circleId}/emergency/${requestId}`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const r = await orNotFound(getAssistance(ctx, circleId, requestId));
  const { locale, t } = await getRequestTranslator();
  const number = circle.profile.emergencyNumber;
  const live = r.status === "open" || r.status === "acknowledged";
  const caps = new Set(circle.myCapabilities);
  const canAct = caps.has("emergency.raise") && circle.status === "active";
  const canCancel = live && (r.raisedById === session.user.id || circle.myMembership.role === "admin");
  const messages = { network: t("common.errorNetwork"), generic: t("common.errorGeneric"), fixErrors: t("common.fixErrors") };
  const base = `/api/v1/circles/${circleId}/emergency/requests/${requestId}`;
  const fmt = (d: Date) => formatDateTime(d, locale, session.user.timeZone);
  const waited = Math.max(0, Math.round((ctx.now.getTime() - r.raisedAt.getTime()) / 60_000));

  return (
    <div className="flex flex-col gap-6">
      {live && <AutoRefresh seconds={15} />}
      <a href={`tel:${number}`} className="inline-flex min-h-16 items-center self-start rounded-2xl bg-danger px-6 text-2xl font-bold text-primary-foreground">
        📞 {t("emergency.call", { number })}
      </a>

      <section className={`flex flex-col gap-3 rounded-2xl border-4 bg-surface p-5 ${statusClass[r.status]}`} aria-live="polite">
        <h2 className="text-2xl font-bold">
          {r.isPractice && <span className="mr-2 text-warning">{t("emergency.practiceBadge")}</span>}
          {t(`emergency.status_${r.status}`)}
        </h2>
        <p className="text-lg">{t("emergency.raisedBy", { name: r.raisedBy ?? t("audit.someone"), when: fmt(r.raisedAt) })}</p>
        {r.message && (
          <p className="text-lg">
            <span className="font-semibold">{t("emergency.messageLabel")}:</span> {r.message}
          </p>
        )}
        {r.location && (
          <a
            className="font-semibold text-primary underline"
            target="_blank"
            rel="noopener noreferrer"
            href={`https://www.openstreetmap.org/?mlat=${r.location.latitude}&mlon=${r.location.longitude}#map=17/${r.location.latitude}/${r.location.longitude}`}
          >
            {t("emergency.locationLink")}
          </a>
        )}
        {r.status === "open" && <p className="text-lg font-bold text-danger">{t("emergency.noResponse", { minutes: waited, number })}</p>}
        {r.status === "open" && r.nextEscalationAt && <p>{t("emergency.nextStep", { when: fmt(r.nextEscalationAt) })}</p>}
        {r.acknowledgedBy && r.acknowledgedAt && r.status !== "cancelled" && (
          <p className="text-lg font-semibold">{t("emergency.respondedBy", { name: r.acknowledgedBy, when: fmt(r.acknowledgedAt) })}</p>
        )}
        {r.status === "resolved" && r.resolvedAt && (
          <p className="text-lg">{t("emergency.resolvedBy", { name: r.resolvedBy ?? t("audit.someone"), when: fmt(r.resolvedAt), note: r.resolutionNote ?? "" })}</p>
        )}
        <p className="text-muted">{t("emergency.notService")}</p>
        {live && <p className="text-muted">{t("emergency.liveNote")}</p>}

        {canAct && live && (
          <div className="flex flex-wrap items-start gap-3">
            {r.status === "open" && (
              <ActionButton method="POST" url={`${base}/acknowledge`} variant="primary" messages={messages}>
                {t("emergency.responding")}
              </ActionButton>
            )}
            <SimpleForm
              method="POST"
              url={`${base}/resolve`}
              openLabel={t("emergency.resolve")}
              submitLabel={t("emergency.resolve")}
              cancelLabel={t("common.cancel")}
              messages={messages}
              fields={[{ name: "note", type: "textarea", label: t("emergency.resolveNote"), required: true, maxLength: 1000 }]}
            />
            {canCancel && (
              <ActionButton method="POST" url={`${base}/cancel`} confirm={t("emergency.falseAlarmConfirm")} messages={messages}>
                {t("emergency.falseAlarm")}
              </ActionButton>
            )}
          </div>
        )}
      </section>

      {!r.emailConfigured && <p className="rounded-lg border-l-4 border-warning bg-surface p-4 font-medium">{t("emergency.noEmailProvider")}</p>}

      <section aria-labelledby="delivery-heading" className="flex flex-col gap-3">
        <h2 id="delivery-heading" className="text-2xl font-semibold">
          {t("emergency.deliveryTitle")}
        </h2>
        {r.deliveries.length === 0 ? (
          <p className="text-muted">{t("emergency.noDeliveries")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b-2 border-border">
                  <th scope="col" className="p-2">{t("emergency.colPerson")}</th>
                  <th scope="col" className="p-2">{t("emergency.colAlerted")}</th>
                  <th scope="col" className="p-2">{t("emergency.colSeen")}</th>
                  <th scope="col" className="p-2">{t("emergency.colEmail")}</th>
                </tr>
              </thead>
              <tbody>
                {r.deliveries.map((d) => (
                  <tr key={d.userId} className="border-b border-border">
                    <th scope="row" className="p-2 font-semibold">{d.name}</th>
                    <td className="p-2">{fmt(d.alertedAt)}</td>
                    <td className={`p-2 ${d.seenAt ? "text-success" : "font-semibold text-warning"}`}>{d.seenAt ? `✓ ${t("emergency.seen")}` : t("emergency.notSeen")}</td>
                    <td className={`p-2 ${d.emailStatus === "failed" || d.emailStatus === "logged" ? "text-warning" : ""}`}>{t(`emergency.email_${d.emailStatus ?? "none"}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {r.contactsWithoutAlerts.length > 0 && (
        <section aria-labelledby="phone-heading" className="flex flex-col gap-3">
          <h2 id="phone-heading" className="text-2xl font-semibold">
            {t("emergency.phoneThese")}
          </h2>
          <ul className="flex flex-col gap-2">
            {r.contactsWithoutAlerts.map((c) => (
              <li key={`${c.name}-${c.phone}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
                <span className="text-lg font-semibold">
                  {c.name}
                  {c.relationship && <span className="font-normal text-muted"> · {c.relationship}</span>}
                </span>
                <a href={`tel:${c.phone}`} className="inline-flex min-h-12 items-center rounded-lg bg-primary px-5 font-semibold text-primary-foreground">
                  📞 {c.phone}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
