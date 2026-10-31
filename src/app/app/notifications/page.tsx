import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { getRequestTranslator } from "@/i18n/server";
import { formatDateTime } from "@/lib/format";
import { pageContext } from "@/server/page";
import { listNotifications } from "@/server/services/notifications";

export const metadata: Metadata = { title: "Notifications" };

const priorityClass = {
  critical: "border-l-8 border-danger",
  high: "border-l-8 border-warning",
  normal: "border-l-4 border-border",
  low: "border-l-4 border-border",
};

export default async function NotificationsPage() {
  const { session, ctx } = await pageContext("/app/notifications");
  const { locale, t } = await getRequestTranslator();
  const { notifications, unreadCount } = await listNotifications(ctx, { limit: 50 });
  const messages = { network: t("common.errorNetwork"), generic: t("common.errorGeneric"), fixErrors: t("common.fixErrors") };

  return (
    <div lang={locale} className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{t("inbox.title")}</h1>
        {unreadCount > 0 && (
          <ActionButton method="POST" url="/api/v1/notifications/read-all" messages={messages}>
            {t("inbox.markAllRead")}
          </ActionButton>
        )}
      </div>

      {notifications.length === 0 ? (
        <p className="text-muted">{t("inbox.empty")}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {notifications.map((n) => {
            const others = n.acknowledgedBy.filter((a) => a.userId !== session.user.id);
            const urgent = n.priority === "high" || n.priority === "critical";
            return (
              <li key={n.id} className={`flex flex-col gap-2 rounded-xl bg-surface p-5 ${priorityClass[n.priority]} ${n.readAt ? "" : "shadow-md"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-xl font-semibold">
                    {!n.readAt && <span className="sr-only">{t("inbox.unread")}: </span>}
                    {t(`inbox.priority_${n.priority}`) && <span className="mr-2 font-bold text-danger">{t(`inbox.priority_${n.priority}`)}:</span>}
                    {n.title}
                  </h2>
                  <time className="text-muted" dateTime={n.createdAt.toISOString()}>
                    {formatDateTime(n.createdAt, locale, session.user.timeZone)}
                  </time>
                </div>
                <p>{n.body}</p>
                {n.acknowledgedAt && <p className="font-medium text-success">✓ {t("inbox.youAreChecking")}</p>}
                {others.length > 0 && <p className="font-medium">{t("inbox.othersChecking", { names: others.map((a) => a.name).join(", ") })}</p>}
                {n.emailStatus && <p className="text-muted">{t(`inbox.email_${n.emailStatus}`)}</p>}
                <div className="flex flex-wrap items-start gap-3">
                  {n.link && (
                    <Link href={n.link} className="inline-flex min-h-12 items-center rounded-lg bg-primary px-5 font-semibold text-primary-foreground">
                      {t("inbox.open")}
                    </Link>
                  )}
                  {urgent && !n.acknowledgedAt && (
                    <ActionButton method="POST" url={`/api/v1/notifications/${n.id}/acknowledge`} variant="primary" messages={messages}>
                      {t("inbox.checking")}
                    </ActionButton>
                  )}
                  {!n.readAt && (
                    <ActionButton method="POST" url={`/api/v1/notifications/${n.id}/read`} messages={messages}>
                      {t("inbox.markRead")}
                    </ActionButton>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
