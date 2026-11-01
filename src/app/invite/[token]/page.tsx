import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { getRequestTranslator } from "@/i18n/server";
import { formatDate } from "@/lib/format";
import { getCurrentSession } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError } from "@/server/http";
import { previewInvitation } from "@/server/services/invitations";
import { AcceptInvitation } from "./accept-invitation";

export const metadata: Metadata = { title: "Invitation", referrer: "no-referrer" };

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <div className="flex flex-1 flex-col items-center px-4 py-10">
      <Link href="/" className="mb-8 text-2xl font-bold text-primary">
        CareNest
      </Link>
      <main id="main" className="w-full max-w-lg card sm:p-8">
        <Suspense fallback={<p aria-busy="true">…</p>}>
          <Invite params={params} />
        </Suspense>
      </main>
    </div>
  );
}

async function Invite({ params }: { params: PageProps<"/invite/[token]">["params"] }) {
  const { token } = await params;
  const { locale, t } = await getRequestTranslator();
  const session = await getCurrentSession();
  const now = new Date();

  let invitation;
  try {
    invitation = await previewInvitation(await getDb(), token, now);
  } catch (err) {
    if (err instanceof AppError && err.code === "not_found") return <Alert tone="error">{t("invite.invalid")}</Alert>;
    throw err;
  }

  const inviter = invitation.inviterName ?? t("audit.someone");
  const returnTo = `/invite/${token}`;
  const tz = session?.user.timeZone ?? "UTC";

  return (
    <div lang={locale} className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold">{t("invite.title")}</h1>
      <p className="text-lg">
        {t("invite.body", {
          inviter,
          circle: invitation.circleName,
          recipient: invitation.recipientName,
          role: t(`roles.${invitation.role}`),
        })}
      </p>
      <p className="text-muted">{t(`roleHints.${invitation.role}`)}</p>
      {invitation.accessExpiresAt && <p>{t("invite.tempAccess", { date: formatDate(invitation.accessExpiresAt, locale, tz) })}</p>}
      <p className="font-medium">{t("invite.forEmail", { email: invitation.email })}</p>

      {invitation.status !== "pending" ? (
        <Alert tone="error">{t(`invite.status_${invitation.status}`, { inviter })}</Alert>
      ) : session ? (
        <AcceptInvitation
          token={token}
          labels={{
            accept: t("invite.accept"),
            network: t("common.errorNetwork"),
            generic: t("common.errorGeneric"),
            fixErrors: t("common.fixErrors"),
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/login?next=${encodeURIComponent(returnTo)}`}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-lg font-semibold text-primary-foreground shadow-sm transition hover:brightness-110"
          >
            {t("invite.signInToAccept")}
          </Link>
          <Link
            href={`/register?next=${encodeURIComponent(returnTo)}`}
            className="inline-flex min-h-12 items-center rounded-xl border-2 border-border bg-surface transition hover:border-primary px-5 font-semibold"
          >
            {t("invite.createToAccept")}
          </Link>
        </div>
      )}
    </div>
  );
}
