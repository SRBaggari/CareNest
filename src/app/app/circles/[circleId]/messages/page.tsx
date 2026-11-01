import { CalendarDays, ChevronRight, ListChecks, MessageSquarePlus, MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge, IconTile, SectionCard } from "@/components/ui/section";
import { getRequestTranslator } from "@/i18n/server";
import { formatDateTime } from "@/lib/format";
import { orForbidden, orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { listThreads, messageRecipients } from "@/server/services/messages";
import { StartThreadForm } from "./message-forms";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage({ params }: PageProps<"/app/circles/[circleId]/messages">) {
  const { circleId } = await params;
  const { ctx } = await pageContext(`/app/circles/${circleId}/messages`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const { locale, t } = await getRequestTranslator();
  const name = circle.profile.preferredName ?? circle.profile.displayName;
  const threads = await orForbidden(listThreads(ctx, circleId));
  if (!threads) return <Alert>{t("common.notAllowed")}</Alert>;
  const canPost = circle.myCapabilities.includes("update.post") && circle.status === "active";
  const people = canPost ? await messageRecipients(ctx, circleId) : [];
  const messages = { network: t("common.errorNetwork"), generic: t("common.errorGeneric"), fixErrors: t("common.fixErrors") };
  const subjectIcon = { appointment: CalendarDays, task: ListChecks, general: MessagesSquare };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("messages.title")} description={t("messages.intro", { name })} />

      {threads.length === 0 ? (
        <EmptyState icon={MessagesSquare}>{t("messages.none")}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {threads.map((th) => {
            const Icon = subjectIcon[th.subjectType];
            return (
              <li key={th.id}>
                <Link href={`/app/circles/${circleId}/messages/${th.id}`} className="card group flex items-center gap-4 transition hover:border-primary">
                  <IconTile icon={Icon} tone={th.unread > 0 ? "primary" : "neutral"} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`text-lg group-hover:text-primary ${th.unread > 0 ? "font-bold" : "font-semibold"}`}>{th.title}</span>
                      {th.unread > 0 && <Badge tone="primary">{t("messages.unread", { count: th.unread })}</Badge>}
                    </span>
                    {th.subjectType !== "general" && <span className="block text-base text-muted">{t(`messages.about_${th.subjectType}`)}</span>}
                    {th.last && (
                      <span className="block truncate text-base text-muted">
                        <span className="font-semibold">{th.last.author ?? t("audit.someone")}:</span> {th.last.preview ?? t("messages.removed")} ·{" "}
                        {formatDateTime(th.last.createdAt, locale, circle.profile.timeZone)}
                      </span>
                    )}
                  </span>
                  <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {canPost && (
        <SectionCard id="start-heading" icon={MessageSquarePlus} title={t("messages.start")}>
          <StartThreadForm
            url={`/api/v1/circles/${circleId}/threads`}
            circleId={circleId}
            people={people}
            labels={{
              ...messages,
              ...(Object.fromEntries((["subject", "subjectHint", "message", "notify", "notifyHint", "start"] as const).map((k) => [k, t(`messages.${k}`)])) as Record<string, string>),
            } as Parameters<typeof StartThreadForm>[0]["labels"]}
          />
        </SectionCard>
      )}
    </div>
  );
}
