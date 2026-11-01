import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { getRequestTranslator } from "@/i18n/server";
import { auditKey } from "@/lib/audit-labels";
import { formatDateTime } from "@/lib/format";
import { orForbidden, orNotFound, pageContext } from "@/server/page";
import { listAuditEvents } from "@/server/services/audit";
import { getCircle } from "@/server/services/circles";

export const metadata: Metadata = { title: "Activity log" };

export default async function ActivityPage({ params }: PageProps<"/app/circles/[circleId]/activity">) {
  const { circleId } = await params;
  const { session, ctx } = await pageContext(`/app/circles/${circleId}/activity`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const events = await orForbidden(listAuditEvents(ctx, circleId, { limit: 100 }));
  if (!events) return <Alert>{t("common.notAllowed")}</Alert>;
  const name = circle.profile.preferredName ?? circle.profile.displayName;

  return (
    <section aria-labelledby="activity-heading">
      <h2 id="activity-heading" className="text-2xl font-semibold">
        {t("circle.activityTitle")}
      </h2>
      <p className="mt-2 text-muted">{t("circle.activityIntro", { name })}</p>
      {events.length === 0 ? (
        <p className="mt-4">{t("circle.noActivity")}</p>
      ) : (
        <ol className="mt-4 flex flex-col gap-2">
          {events.map((e) => {
            const meta = e.metadata as { email?: string; role?: string; name?: string };
            const vars = { email: meta.email ?? "", role: meta.role ? t(`roles.${meta.role}`) : "", name: meta.name ?? "" };
            return (
              <li key={e.id} className="rounded-xl border border-border bg-sunken p-4">
                <p>
                  <span className="font-semibold">{e.actor?.name ?? t("audit.someone")}</span> {t(`audit.${auditKey(e.action)}`, vars)}
                </p>
                <p className="text-muted">
                  <time dateTime={e.createdAt.toISOString()}>{formatDateTime(e.createdAt, locale, session.user.timeZone)}</time>
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
