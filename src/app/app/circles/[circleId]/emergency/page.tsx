import { Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { SimpleForm } from "@/components/simple-form";
import { getRequestTranslator } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/lib/format";
import { orNotFound, pageContext } from "@/server/page";
import { ESCALATION_MINUTES, listAssistance } from "@/server/services/assistance";
import { getCircle } from "@/server/services/circles";
import { getEmergencyInfo, INFO_FIELDS, listEmergencyContacts } from "@/server/services/emergency";
import { listMembers } from "@/server/services/members";
import { HelpButton } from "./help-button";

export const metadata: Metadata = { title: "Emergency" };

export default async function EmergencyPage({ params }: PageProps<"/app/circles/[circleId]/emergency">) {
  const { circleId } = await params;
  const { session, ctx } = await pageContext(`/app/circles/${circleId}/emergency`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const [card, contacts, requests] = await Promise.all([getEmergencyInfo(ctx, circleId), listEmergencyContacts(ctx, circleId), listAssistance(ctx, circleId)]);
  const caps = new Set(circle.myCapabilities);
  const active = circle.status === "active";
  const canRaise = caps.has("emergency.raise") && active;
  const canEdit = caps.has("circle.manage") && active;
  const members = canEdit ? await listMembers(ctx, circleId) : [];
  const number = card.emergencyNumber;
  const messages = { network: t("common.errorNetwork"), generic: t("common.errorGeneric"), fixErrors: t("common.fixErrors") };
  const base = `/api/v1/circles/${circleId}/emergency`;
  const fmt = (d: Date) => formatDateTime(d, locale, session.user.timeZone);
  const openRequest = requests.find((r) => !r.isPractice && (r.status === "open" || r.status === "acknowledged"));
  const filled = INFO_FIELDS.filter((f) => card.info[f]);
  const helpLabels = {
    ...Object.fromEntries(["needHelp", "confirmTitle", "message", "shareLocation", "locationFailed", "yesAlert", "cancel", "sending"].map((k) => [k, t(`emergency.${k}`)])),
    confirmBody: t("emergency.confirmBody", { number }),
    network: messages.network,
    generic: messages.generic,
  } as Parameters<typeof HelpButton>[0]["labels"];

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="call-heading" className="flex flex-col gap-3 rounded-2xl border-4 border-danger bg-surface p-5">
        <h2 id="call-heading" className="sr-only">
          {t("emergency.call", { number })}
        </h2>
        <a href={`tel:${number}`} className="inline-flex min-h-20 items-center justify-center gap-4 self-start rounded-3xl bg-danger px-8 text-3xl font-bold text-primary-foreground shadow-lg shadow-danger/25 transition hover:brightness-110">
          <Phone aria-hidden="true" className="size-8 shrink-0" />
          {t("emergency.call", { number })}
        </a>
        <p className="text-lg">{t("emergency.callHint")}</p>
        <p className="font-medium">{t("emergency.notService")}</p>
      </section>

      {openRequest && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-4 border-warning bg-surface p-5" role="status">
          <p className="text-xl font-bold">{t("emergency.activeTitle")}</p>
          <Link href={`/app/circles/${circleId}/emergency/${openRequest.id}`} className="inline-flex min-h-14 items-center rounded-xl bg-primary px-6 text-lg font-bold text-primary-foreground">
            {t("emergency.open")}
          </Link>
        </section>
      )}

      {canRaise && !openRequest && <HelpButton url={`${base}/requests`} circleId={circleId} labels={helpLabels} />}

      <section aria-labelledby="card-heading" className="card">
        <h2 id="card-heading" className="text-2xl font-semibold">
          {t("emergency.infoTitle")}
        </h2>
        <p className="mt-1 text-muted">{t("emergency.infoIntro")}</p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-muted">{t("circle.recipientName")}</dt>
            <dd className="text-lg font-semibold">{card.recipient.name}</dd>
          </div>
          {card.recipient.dateOfBirth && (
            <div>
              <dt className="text-muted">{t("emergency.dob")}</dt>
              <dd className="text-lg">{formatDate(`${card.recipient.dateOfBirth}T12:00:00Z`, locale, "UTC")}</dd>
            </div>
          )}
          {filled.map((f) => (
            <div key={f}>
              <dt className="text-muted">{t(`emergency.field_${f}`)}</dt>
              <dd className="whitespace-pre-line text-lg">
                {f === "doctorPhone" ? (
                  <a className="font-semibold text-primary underline" href={`tel:${card.info[f]}`}>
                    {card.info[f]}
                  </a>
                ) : (
                  card.info[f]
                )}
              </dd>
            </div>
          ))}
        </dl>
        {filled.length === 0 && <p className="mt-3 text-muted">{t("emergency.infoEmpty")}</p>}
        {card.updatedAt && card.updatedBy && <p className="mt-3 text-muted">{t("emergency.updatedBy", { name: card.updatedBy, when: fmt(card.updatedAt) })}</p>}
        {canEdit && (
          <div className="mt-4">
            <SimpleForm
              method="PUT"
              url={`${base}/info`}
              openLabel={t("emergency.infoEdit")}
              submitLabel={t("emergency.infoSave")}
              cancelLabel={t("common.cancel")}
              messages={messages}
              fields={INFO_FIELDS.map((f) => ({
                name: f,
                type: f === "bloodGroup" || f === "doctorPhone" || f === "doctorName" ? ("text" as const) : ("textarea" as const),
                label: t(`emergency.field_${f}`),
                defaultValue: card.info[f] ?? "",
                maxLength: f === "bloodGroup" ? 10 : 1000,
              }))}
            />
          </div>
        )}
      </section>

      <section aria-labelledby="contacts-heading" className="flex flex-col gap-3">
        <h2 id="contacts-heading" className="text-2xl font-semibold">
          {t("emergency.contactsTitle")}
        </h2>
        <p className="text-muted">{t("emergency.contactsIntro", { minutes: ESCALATION_MINUTES })}</p>
        {contacts.length === 0 && <p>{t("emergency.noContacts")}</p>}
        <ul className="flex flex-col gap-3">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 card">
              <div>
                <p className="text-lg font-semibold">
                  {c.name}
                  {c.relationship && <span className="font-normal text-muted"> · {c.relationship}</span>}
                </p>
                <p className="text-muted">
                  {t("emergency.tier", { tier: c.tier })} · {c.receivesAlerts ? t("emergency.getsAlerts") : t("emergency.phoneOnly")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={`tel:${c.phone}`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-lg font-semibold text-primary-foreground shadow-sm transition hover:brightness-110">
                  <Phone aria-hidden="true" className="size-5 shrink-0" />
                  {c.phone}
                </a>
                {canEdit && (
                  <ActionButton method="DELETE" url={`${base}/contacts/${c.id}`} confirm={t("emergency.removeConfirm", { name: c.name })} variant="danger" messages={messages}>
                    {t("emergency.removeContact")}
                  </ActionButton>
                )}
              </div>
            </li>
          ))}
        </ul>
        {canEdit && (
          <SimpleForm
            method="POST"
            url={`${base}/contacts`}
            openLabel={t("emergency.addContact")}
            submitLabel={t("emergency.saveContact")}
            cancelLabel={t("common.cancel")}
            messages={messages}
            fields={[
              { name: "name", type: "text", label: t("emergency.contactName"), required: true, maxLength: 100 },
              { name: "phone", type: "text", label: t("emergency.contactPhone"), required: true, maxLength: 20 },
              { name: "relationship", type: "text", label: t("emergency.contactRelationship"), maxLength: 100 },
              { name: "tier", type: "select", label: t("emergency.contactTier"), defaultValue: "1", options: [1, 2, 3].map((n) => ({ value: String(n), label: t("emergency.tier", { tier: n }) })) },
              {
                name: "memberId",
                type: "select",
                label: t("emergency.contactMember"),
                defaultValue: "",
                options: [{ value: "", label: t("emergency.notMember") }, ...members.map((m) => ({ value: m.id, label: m.name }))],
              },
            ]}
          />
        )}
      </section>

      {canRaise && caps.has("circle.manage") && <HelpButton url={`${base}/requests`} circleId={circleId} practice labels={{ ...helpLabels, needHelp: t("emergency.practice"), confirmBody: t("emergency.practiceConfirm") }} />}

      <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
        <h2 id="recent-heading" className="text-2xl font-semibold">
          {t("emergency.recentTitle")}
        </h2>
        {requests.length === 0 && <p className="text-muted">{t("emergency.noRequests")}</p>}
        <ul className="flex flex-col gap-2">
          {requests.map((r) => (
            <li key={r.id}>
              <Link href={`/app/circles/${circleId}/emergency/${r.id}`} className="flex flex-wrap justify-between gap-2 rounded-xl border border-border bg-sunken p-4 hover:border-primary">
                <span className="font-semibold">
                  {r.isPractice && <span className="mr-2 text-warning">{t("emergency.practiceBadge")}</span>}
                  {t("emergency.raisedBy", { name: r.raisedBy ?? t("audit.someone"), when: fmt(r.createdAt) })}
                </span>
                <span className="text-muted">{t(`emergency.status_${r.status}`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
