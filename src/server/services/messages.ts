// Circle conversations: general, or about one appointment or task. Readable by the people who see
// care updates; one about an appointment or task also needs permission to see that appointment or
// task (so the parent's choice not to share appointments covers their conversations too).

import { and, asc, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { messages, messageThreads, threadReads, users } from "@/server/db/schema";
import { AppError } from "@/server/http";
import { appUrl, circleAudience, translatorFor, type AudienceMember } from "@/server/notifications/audience";
import { uuidSchema } from "@/server/validation";
import { authorize, type CircleAccess, type ServiceContext } from "./access";
import { getAppointment } from "./appointments";
import { notifyUsers } from "./notifications";
import { getTask } from "./tasks";

const body = z.string().trim().min(1, "Write a message.").max(4000);
/** Membership ids of people to let know (they get an alert); others in the conversation get quiet news. */
const notify = z.array(z.string()).max(30).default([]);

export const startThreadSchema = z.object({
  title: z.string().trim().min(1, "Give the conversation a subject.").max(120),
  body,
  notify,
});
export const postMessageSchema = z.object({ body, notify });
export const subjectSchema = z.object({ subjectType: z.enum(["appointment", "task"]), subjectId: z.string() });

type Thread = typeof messageThreads.$inferSelect;
const author = alias(users, "author");
const notFound = () => new AppError("not_found", "That conversation wasn't found.");

function canSeeSubject(access: CircleAccess, subjectType: Thread["subjectType"]) {
  if (subjectType === "appointment") return access.can("appointment.view");
  if (subjectType === "task") return access.can("task.view");
  return true;
}

async function loadThread(ctx: ServiceContext, access: CircleAccess, threadId: string) {
  if (!uuidSchema.safeParse(threadId).success) throw notFound();
  const [thread] = await ctx.db.select().from(messageThreads).where(and(eq(messageThreads.id, threadId), eq(messageThreads.circleId, access.circle.id)));
  if (!thread || !canSeeSubject(access, thread.subjectType)) throw notFound();
  return thread;
}

export async function listThreads(ctx: ServiceContext, circleId: string) {
  const access = await authorize(ctx, circleId, "update.view");
  const lastRead = alias(threadReads, "last_read");
  const threads = await ctx.db
    .select({ thread: messageThreads, lastReadAt: lastRead.lastReadAt })
    .from(messageThreads)
    .leftJoin(lastRead, and(eq(lastRead.threadId, messageThreads.id), eq(lastRead.userId, ctx.userId)))
    .where(eq(messageThreads.circleId, circleId))
    .orderBy(desc(messageThreads.lastMessageAt))
    .limit(100);
  const visible = threads.filter((t) => canSeeSubject(access, t.thread.subjectType));
  if (visible.length === 0) return [];
  const ids = visible.map((t) => t.thread.id);
  const [latest, unread] = await Promise.all([
    ctx.db
      .selectDistinctOn([messages.threadId], { threadId: messages.threadId, body: messages.body, removedAt: messages.removedAt, author: author.name, createdAt: messages.createdAt })
      .from(messages)
      .leftJoin(author, eq(author.id, messages.authorUserId))
      .where(inArray(messages.threadId, ids))
      .orderBy(messages.threadId, desc(messages.createdAt)),
    ctx.db
      .select({ threadId: messages.threadId, n: count() })
      .from(messages)
      .leftJoin(threadReads, and(eq(threadReads.threadId, messages.threadId), eq(threadReads.userId, ctx.userId)))
      .where(
        and(
          inArray(messages.threadId, ids),
          isNull(messages.removedAt),
          sql`(${messages.authorUserId} is null or ${messages.authorUserId} <> ${ctx.userId})`,
          sql`(${threadReads.lastReadAt} is null or ${messages.createdAt} > ${threadReads.lastReadAt})`,
        ),
      )
      .groupBy(messages.threadId),
  ]);
  const last = new Map(latest.map((m) => [m.threadId, m]));
  const unreadBy = new Map(unread.map((u) => [u.threadId, u.n]));
  return visible.map(({ thread }) => {
    const m = last.get(thread.id);
    return {
      id: thread.id,
      title: thread.title,
      subjectType: thread.subjectType,
      subjectId: thread.subjectId,
      lastMessageAt: thread.lastMessageAt,
      last: m ? { author: m.author, preview: m.removedAt ? null : (m.body ?? "").slice(0, 140), createdAt: m.createdAt } : null,
      unread: unreadBy.get(thread.id) ?? 0,
    };
  });
}

/** A conversation's messages, oldest first; opening it marks it read for this person. */
export async function getThread(ctx: ServiceContext, circleId: string, threadId: string) {
  const access = await authorize(ctx, circleId, "update.view");
  const thread = await loadThread(ctx, access, threadId);
  const rows = await ctx.db
    .select({ id: messages.id, body: messages.body, createdAt: messages.createdAt, removedAt: messages.removedAt, authorId: messages.authorUserId, author: author.name })
    .from(messages)
    .leftJoin(author, eq(author.id, messages.authorUserId))
    .where(eq(messages.threadId, thread.id))
    .orderBy(asc(messages.createdAt))
    .limit(500);
  await ctx.db
    .insert(threadReads)
    .values({ threadId: thread.id, userId: ctx.userId, lastReadAt: ctx.now })
    .onConflictDoUpdate({ target: [threadReads.threadId, threadReads.userId], set: { lastReadAt: ctx.now } });
  return { id: thread.id, title: thread.title, subjectType: thread.subjectType, subjectId: thread.subjectId, messages: rows };
}

export async function startThread(ctx: ServiceContext, circleId: string, raw: z.input<typeof startThreadSchema>) {
  const input = startThreadSchema.parse(raw);
  await authorize(ctx, circleId, "update.post", { write: true });
  // One transaction: if the first message is refused, no empty conversation is left behind.
  return ctx.db.transaction(async (tx) => {
    const [thread] = await tx
      .insert(messageThreads)
      .values({ circleId, title: input.title, createdBy: ctx.userId, createdAt: ctx.now, lastMessageAt: ctx.now })
      .returning();
    await addMessage({ ...ctx, db: tx }, thread, input.body, input.notify);
    return { id: thread.id };
  });
}

/** The conversation about an appointment or task, started on first use. */
export async function threadForSubject(ctx: ServiceContext, circleId: string, raw: z.input<typeof subjectSchema>) {
  const input = subjectSchema.parse(raw);
  const access = await authorize(ctx, circleId, "update.view");
  if (!uuidSchema.safeParse(input.subjectId).success) throw notFound();
  // Reading the subject checks the person may see it (and that it is in this circle).
  const subject = input.subjectType === "appointment" ? await getAppointment(ctx, circleId, input.subjectId) : await getTask(ctx, circleId, input.subjectId);
  const [existing] = await ctx.db
    .select({ id: messageThreads.id })
    .from(messageThreads)
    .where(and(eq(messageThreads.circleId, circleId), eq(messageThreads.subjectType, input.subjectType), eq(messageThreads.subjectId, input.subjectId)));
  if (existing) return { id: existing.id };
  if (!access.can("update.post") || access.circle.status !== "active") throw notFound();
  const [created] = await ctx.db
    .insert(messageThreads)
    .values({ circleId, title: subject.title, subjectType: input.subjectType, subjectId: input.subjectId, createdBy: ctx.userId, createdAt: ctx.now, lastMessageAt: ctx.now })
    .onConflictDoNothing()
    .returning({ id: messageThreads.id });
  if (created) return created;
  const [raced] = await ctx.db
    .select({ id: messageThreads.id })
    .from(messageThreads)
    .where(and(eq(messageThreads.circleId, circleId), eq(messageThreads.subjectType, input.subjectType), eq(messageThreads.subjectId, input.subjectId)));
  return { id: raced.id };
}

export async function postMessage(ctx: ServiceContext, circleId: string, threadId: string, raw: z.input<typeof postMessageSchema>) {
  const input = postMessageSchema.parse(raw);
  const access = await authorize(ctx, circleId, "update.post", { write: true });
  const thread = await loadThread(ctx, access, threadId);
  return addMessage(ctx, thread, input.body, input.notify);
}

async function addMessage(ctx: ServiceContext, thread: Thread, text: string, notifyIds: string[]) {
  // Check who to let know before saving anything; alerts only reach people who can read this conversation.
  const audience = (await circleAudience(ctx.db, thread.circleId, ctx.now)).filter(
    (m) => m.userId !== ctx.userId && m.can("update.view") && (thread.subjectType === "general" || m.can(thread.subjectType === "appointment" ? "appointment.view" : "task.view")),
  );
  const asked = new Set(notifyIds);
  const unknown = notifyIds.filter((id) => !audience.some((m) => m.memberId === id));
  if (unknown.length > 0) throw new AppError("validation_failed", "Some fields are invalid.", { notify: ["Some of those people can't read this conversation."] });
  const [message] = await ctx.db
    .insert(messages)
    .values({ threadId: thread.id, circleId: thread.circleId, authorUserId: ctx.userId, body: text, createdAt: ctx.now })
    .returning({ id: messages.id });
  await ctx.db.update(messageThreads).set({ lastMessageAt: ctx.now }).where(eq(messageThreads.id, thread.id));
  // My own message is read by me.
  await ctx.db
    .insert(threadReads)
    .values({ threadId: thread.id, userId: ctx.userId, lastReadAt: ctx.now })
    .onConflictDoUpdate({ target: [threadReads.threadId, threadReads.userId], set: { lastReadAt: ctx.now } });

  const participants = new Set(
    (
      await ctx.db
        .selectDistinct({ userId: messages.authorUserId })
        .from(messages)
        .where(and(eq(messages.threadId, thread.id), ne(messages.id, message.id)))
    ).map((r) => r.userId),
  );
  if (thread.createdBy) participants.add(thread.createdBy);
  const [me] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId));
  const link = `/app/circles/${thread.circleId}/messages/${thread.id}`;
  const recipients = audience.filter((m) => asked.has(m.memberId) || participants.has(m.userId));
  await notifyUsers(
    ctx.db,
    ctx.now,
    recipients.map((r: AudienceMember) => {
      const t = translatorFor(r.locale);
      const vars = { author: me.name, title: thread.title, body: text.slice(0, 300), link: appUrl(link) };
      const askedFor = asked.has(r.memberId);
      return {
        userId: r.userId,
        circleId: thread.circleId,
        kind: askedFor ? "message_for_you" : "message",
        // Someone asked for this person: an alert. Otherwise quiet news for the evening digest.
        priority: askedFor ? ("normal" as const) : ("low" as const),
        title: t(askedFor ? "notif.messageForYouTitle" : "notif.messageTitle", vars),
        body: t("notif.updateImportantBody", vars),
        link,
        groupKey: `thread:${thread.id}`,
        dedupeKey: `message:${message.id}:${r.userId}`,
        // The email never contains the message itself.
        email: askedFor ? { subject: t("notif.messageEmailSubject", vars), text: t("notif.messageEmailBody", vars) } : undefined,
      };
    }),
  );
  return message;
}

/** Authors can take back their own message; the conversation shows "Message removed". */
export async function removeMessage(ctx: ServiceContext, circleId: string, messageId: string) {
  const access = await authorize(ctx, circleId, "update.view");
  if (!uuidSchema.safeParse(messageId).success) throw notFound();
  const [row] = await ctx.db
    .select({ message: messages, thread: messageThreads })
    .from(messages)
    .innerJoin(messageThreads, eq(messageThreads.id, messages.threadId))
    .where(and(eq(messages.id, messageId), eq(messages.circleId, circleId), isNull(messages.removedAt)));
  if (!row || !canSeeSubject(access, row.thread.subjectType)) throw notFound();
  if (row.message.authorUserId !== ctx.userId) throw new AppError("forbidden", "You can only remove your own messages.");
  await ctx.db.update(messages).set({ body: null, removedAt: ctx.now }).where(eq(messages.id, messageId));
}

/** Unread conversations for this person, for the circle tab's badge. */
export async function unreadThreadCount(ctx: ServiceContext, circleId: string) {
  const threads = await listThreads(ctx, circleId);
  return threads.filter((t) => t.unread > 0).length;
}


/** People who can read a conversation of this kind (not me), for "Let these people know". */
export async function messageRecipients(ctx: ServiceContext, circleId: string, subjectType: Thread["subjectType"] = "general") {
  await authorize(ctx, circleId, "update.view");
  const audience = (await circleAudience(ctx.db, circleId, ctx.now)).filter(
    (m) => m.userId !== ctx.userId && m.can("update.view") && (subjectType === "general" || m.can(subjectType === "appointment" ? "appointment.view" : "task.view")),
  );
  if (audience.length === 0) return [];
  const names = await ctx.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, audience.map((m) => m.userId)));
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  return audience.map((m) => ({ memberId: m.memberId, name: nameOf.get(m.userId) ?? "", role: m.role }));
}
