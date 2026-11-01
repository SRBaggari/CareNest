import type { Metadata } from "next";
import { ActionButton } from "@/components/action-button";
import { Alert } from "@/components/ui/alert";
import { CIRCLE_ROLES } from "@/server/auth/permissions";
import { getRequestTranslator } from "@/i18n/server";
import { formatDate } from "@/lib/format";
import { orForbidden, orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { listPendingInvitations } from "@/server/services/invitations";
import { listMembers } from "@/server/services/members";
import { InviteForm, MemberRoleForm } from "./member-forms";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage({ params }: PageProps<"/app/circles/[circleId]/members">) {
  const { circleId } = await params;
  const { session, ctx } = await pageContext(`/app/circles/${circleId}/members`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const tz = session.user.timeZone;
  const messages = { network: t("common.errorNetwork"), generic: t("common.errorGeneric"), fixErrors: t("common.fixErrors") };

  const members = await orForbidden(listMembers(ctx, circleId));
  if (!members) return <Alert>{t("common.notAllowed")}</Alert>;

  const canManage = circle.myCapabilities.includes("members.manage") && circle.status === "active";
  const pending = canManage ? await listPendingInvitations(ctx, circleId) : [];
  const roleOptions = CIRCLE_ROLES.filter((r) => r !== "care_recipient").map((r) => ({ value: r, label: t(`roles.${r}`) }));
  const inviteRoleOptions = CIRCLE_ROLES.filter((r) => r !== "care_recipient" || !circle.profile.hasOwnAccount).map((r) => ({
    value: r,
    label: t(`roles.${r}`),
  }));

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="members-heading">
        <h2 id="members-heading" className="text-2xl font-semibold">
          {t("circle.membersTitle")}
        </h2>
        <ul className="mt-4 flex flex-col gap-3">
          {members.map((m) => {
            const isMe = m.userId === session.user.id;
            return (
              <li key={m.id} className="flex flex-col gap-3 card">
                <div>
                  <p className="text-lg font-semibold">
                    {m.name} {isMe && <span className="font-normal text-muted">{t("circle.you")}</span>}
                  </p>
                  <p>
                    {t(`roles.${m.role}`)}
                    {m.isLegalRepresentative && ` · ${t("circle.legalRep")}`}
                  </p>
                  {m.email && <p className="break-all text-muted">{m.email}</p>}
                  <p className="text-muted">
                    {m.expiresAt
                      ? t("circle.accessUntil", { date: formatDate(m.expiresAt, locale, tz) })
                      : t("circle.joined", { date: formatDate(m.joinedAt, locale, tz) })}
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-4">
                  {canManage && !isMe && m.role !== "care_recipient" && (
                    <>
                      <MemberRoleForm
                        url={`/api/v1/circles/${circleId}/members/${m.id}`}
                        role={m.role}
                        options={roleOptions}
                        labels={{ ...messages, changeRole: t("circle.changeRole"), save: t("common.save") }}
                      />
                      <ActionButton
                        method="DELETE"
                        url={`/api/v1/circles/${circleId}/members/${m.id}`}
                        confirm={t("circle.removeConfirm", { name: m.name })}
                        variant="quietDanger"
                        messages={messages}
                      >
                        {t("circle.removeMember")}
                      </ActionButton>
                    </>
                  )}
                  {isMe && circle.status === "active" && (
                    <ActionButton
                      method="DELETE"
                      url={`/api/v1/circles/${circleId}/members/${m.id}`}
                      confirm={t("circle.leaveConfirm")}
                      redirectTo="/app"
                      variant="secondary"
                      messages={messages}
                    >
                      {t("circle.leave")}
                    </ActionButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {canManage && (
        <>
          <section aria-labelledby="invite-heading" className="card">
            <h2 id="invite-heading" className="text-2xl font-semibold">
              {t("circle.invite")}
            </h2>
            <InviteForm
              url={`/api/v1/circles/${circleId}/invitations`}
              roleOptions={inviteRoleOptions}
              roleHints={Object.fromEntries(CIRCLE_ROLES.map((r) => [r, t(`roleHints.${r}`)]))}
              labels={{
                ...messages,
                email: t("circle.inviteEmail"),
                role: t("circle.inviteRole"),
                temporary: t("circle.inviteTemporary"),
                temporaryHint: t("circle.inviteTemporaryHint"),
                submit: t("circle.sendInvite"),
                created: t("circle.inviteCreated"),
                emailed: t("circle.inviteEmailed"),
                copy: t("common.copy"),
                copied: t("common.copied"),
              }}
            />
          </section>

          <section aria-labelledby="pending-heading">
            <h2 id="pending-heading" className="text-2xl font-semibold">
              {t("circle.pendingInvites")}
            </h2>
            {pending.length === 0 ? (
              <p className="mt-2 text-muted">{t("circle.noPending")}</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {pending.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 card">
                    <div>
                      <p className="break-all font-semibold">{inv.email}</p>
                      <p>{t(`roles.${inv.role}`)}</p>
                      <p className="text-muted">
                        {inv.invitedBy?.name && t("circle.invitedBy", { name: inv.invitedBy.name })} ·{" "}
                        {t("circle.expires", { date: formatDate(inv.expiresAt, locale, tz) })}
                      </p>
                    </div>
                    <ActionButton method="DELETE" url={`/api/v1/circles/${circleId}/invitations/${inv.id}`} messages={messages}>
                      {t("circle.revoke")}
                    </ActionButton>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
