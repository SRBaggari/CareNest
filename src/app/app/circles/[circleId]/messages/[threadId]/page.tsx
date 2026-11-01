import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { Avatar } from "@/components/ui/section";
import { getRequestTranslator } from "@/i18n/server";
import { formatDateTime } from "@/lib/format";
import { orNotFound, pageContext } from "@/server/page";
import { getCircle } from "@/server/services/circles";
import { getThread, messageRecipients } from "@/server/services/messages";
import { ReplyForm } from "../message-forms";

export const metadata: Metadata = { title: "Conversation" };

export default async function ThreadPage({ params }: PageProps<"/app/circles/[circleId]/messages/[threadId]">) {
  const { circleId, threadId } = await params;
  const { session, ctx } = await pageContext(`/app/circles/${circleId}/messages/${threadId}`);
  const circle = await orNotFound(getCircle(ctx, circleId));
  const thread = await orNotFound(getThread(ctx, circleId, threadId));
  const { locale, t } = await getRequestTranslator();
  const canPost = circle.myCapabilities.includes("update.post") && circle.status === "active";
  const people = canPost ? await messageRecipients(ctx, circleId, thread.subjectType) : [];
  const messages = { network: t("common.errorNetwork"), generic: t("common.errorGeneric"), fixErrors: t("common.fixErrors") };
  const when = (d: Date) => formatDateTime(d, locale, circle.profile.timeZone);
  const subjectLink = thread.subjectType === "appointment" ? "appointments" : thread.subjectType === "task" ? "tasks" : null;

  return (
    <div className="flex flex-col gap-5">
      <Link href={`/app/circles/${circleId}/messages`} className="inline-flex min-h-12 items-center gap-1 self-start font-semibold text-primary hover:underline">
        <ChevronLeft aria-hidden="true" className="size-5" />
        {t("messages.back")}
      </Link>
      <div>
        <h2 className="text-2xl font-bold">{thread.title}</h2>
        {subjectLink && (
          <Link href={`/app/circles/${circleId}/${subjectLink}`} className="text-base font-semibold text-primary underline">
            {t(`messages.about_${thread.subjectType}`)}
          </Link>
        )}
      </div>

      {thread.messages.length === 0 ? (
        <p className="text-muted">{t("messages.noMessages")}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {thread.messages.map((m) => {
            const mine = m.authorId === session.user.id;
            return (
              <li key={m.id} className={`flex gap-3 ${mine ? "flex-row-reverse" : ""}`}>
                <Avatar name={m.author ?? "?"} />
                <div className={`min-w-0 max-w-[85%] rounded-2xl px-4 py-3 ${mine ? "bg-primary-soft" : "border border-border bg-surface"}`}>
                  <p className="text-base text-muted">
                    <span className="font-semibold text-foreground">{m.author ?? t("audit.someone")}</span> · {when(m.createdAt)}
                  </p>
                  {m.removedAt ? <p className="italic text-muted">{t("messages.removed")}</p> : <p className="whitespace-pre-line">{m.body}</p>}
                  {mine && !m.removedAt && canPost && (
                    <ActionButton
                      method="DELETE"
                      url={`/api/v1/circles/${circleId}/messages/${m.id}`}
                      confirm={t("messages.removeConfirm")}
                      variant="quietDanger"
                      className="-ml-3 px-3 text-base"
                      messages={messages}
                    >
                      {t("messages.remove")}
                    </ActionButton>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {canPost && (
        <div className="card">
          <ReplyForm
            url={`/api/v1/circles/${circleId}/threads/${thread.id}`}
            people={people}
            labels={{ ...messages, reply: t("messages.reply"), notify: t("messages.notify"), notifyHint: t("messages.notifyHint"), send: t("messages.send") }}
          />
        </div>
      )}
    </div>
  );
}
