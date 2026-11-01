import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { LOCAL_TIME_PATTERN } from "@/server/domain/schedule";
import { emailOutbox, memberships, notificationPreferences, notifications, users } from "@/server/db/schema";
import { translatorFor } from "@/server/notifications/audience";
import { enqueueEmail } from "@/server/notifications/email";
import { enqueuePush, getPushTransport } from "@/server/notifications/push";
import { quietUntil } from "@/server/notifications/quiet-hours";
import { effectiveAlertSettings, ALERT_CAPABILITY, ALERT_KINDS, alertColumn, offersChoice } from "@/server/notifications/alert-settings";
import { AppError } from "@/server/http";
import { uuidSchema } from "@/server/validation";
import { loadCircleAccess, requireWritable, type DbOrTx, type ServiceContext } from "./access";

export type NewNotification = {
  userId: string;
  circleId: string | null;
  kind: string;
  priority: "low" | "normal" | "high" | "critical";
  title: string;
  body: string;
  link: string | null;
  groupKey: string | null;
  dedupeKey: string;
};

/**
 * Creates in-app notifications idempotently (duplicates by dedupe key are ignored) and returns
 * only the ones that were actually new, so callers can fan out email for exactly those.
 */
export async function createNotifications(db: DbOrTx, items: NewNotification[], now: Date) {
  if (items.length === 0) return [];
  return db
    .insert(notifications)
    .values(items.map((n) => ({ ...n, createdAt: now })))
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning();
}

export type EmailContent = { subject: string; text: string };

/**
 * Creates notifications and queues an email copy for each new one, honouring the person's
 * email preference and quiet hours (critical alerts are never held back). Emails carry only
 * minimal, non-medical detail; the full information stays behind sign-in.
 */
export async function notifyUsers(db: DbOrTx, now: Date, items: (NewNotification & { email?: EmailContent })[]) {
  const created = await createNotifications(
    db,
    items.map(({ email: _email, ...n }) => n),
    now,
  );
  const emailFor = new Map(items.map((i) => [i.dedupeKey, i.email]));
  // Phone alerts for anything above low priority (low-priority news waits for the evening digest).
  const pushing = getPushTransport() !== null;
  const withEmail = created.filter((n) => emailFor.get(n.dedupeKey));
  const toPush = pushing ? created.filter((n) => n.priority !== "low") : [];
  if (withEmail.length === 0 && toPush.length === 0) return created;

  const ids = [...new Set([...withEmail, ...toPush].map((n) => n.userId))];
  const people = await db
    .select({
      id: users.id,
      email: users.email,
      locale: users.locale,
      timeZone: users.timeZone,
      emailEnabled: notificationPreferences.emailEnabled,
      quietStart: notificationPreferences.quietStart,
      quietEnd: notificationPreferences.quietEnd,
    })
    .from(users)
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
    .where(inArray(users.id, ids));
  const byId = new Map(people.map((p) => [p.id, p]));
  // Urgent alerts ignore quiet hours; everything else waits until they end.
  const notBeforeFor = (n: (typeof created)[number], person: (typeof people)[number]) =>
    n.priority === "critical" ? now : (quietUntil(now, person.timeZone, person.quietStart, person.quietEnd) ?? now);

  for (const n of toPush) {
    const person = byId.get(n.userId);
    if (!person) continue;
    await enqueuePush(db, {
      userId: n.userId,
      notificationId: n.id,
      // The lock screen is visible to anyone nearby: the title only, details stay behind sign-in.
      payload: { title: n.title, body: translatorFor(person.locale)("notif.pushOpenForDetails"), link: n.link, tag: n.groupKey, urgent: n.priority === "critical" },
      dedupeKey: `notification:${n.id}`,
      notBefore: notBeforeFor(n, person),
    });
  }

  for (const n of withEmail) {
    const person = byId.get(n.userId);
    if (!person || person.emailEnabled === false) continue;
    const notBefore = notBeforeFor(n, person);
    const content = emailFor.get(n.dedupeKey)!;
    await enqueueEmail(db, {
      to: person.email,
      subject: content.subject,
      text: content.text,
      kind: n.kind,
      notificationId: n.id,
      dedupeKey: `notification:${n.id}`,
      notBefore,
    });
  }
  return created;
}

export const listNotificationsQuerySchema = z.object({
  unread: z.enum(["true", "false"]).optional(),
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** Who has said "I'm checking on it" for each group, so nobody assumes someone else is handling it. */
export async function acknowledgementsFor(db: DbOrTx, groupKeys: string[]) {
  if (groupKeys.length === 0) return new Map<string, { userId: string; name: string; at: Date }[]>();
  const rows = await db
    .select({ groupKey: notifications.groupKey, userId: users.id, name: users.name, at: notifications.acknowledgedAt })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(inArray(notifications.groupKey, groupKeys), isNotNull(notifications.acknowledgedAt)))
    .orderBy(notifications.acknowledgedAt);
  const map = new Map<string, { userId: string; name: string; at: Date }[]>();
  for (const r of rows) {
    const list = map.get(r.groupKey!) ?? [];
    list.push({ userId: r.userId, name: r.name, at: r.at! });
    map.set(r.groupKey!, list);
  }
  return map;
}

export async function listNotifications(ctx: ServiceContext, query: z.infer<typeof listNotificationsQuerySchema>) {
  const rows = await ctx.db
    .select({
      id: notifications.id,
      circleId: notifications.circleId,
      kind: notifications.kind,
      priority: notifications.priority,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      groupKey: notifications.groupKey,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
      acknowledgedAt: notifications.acknowledgedAt,
      emailStatus: emailOutbox.status,
    })
    .from(notifications)
    .leftJoin(emailOutbox, eq(emailOutbox.notificationId, notifications.id))
    .where(
      and(
        eq(notifications.userId, ctx.userId),
        query.unread === "true" ? isNull(notifications.readAt) : undefined,
        query.before ? lt(notifications.createdAt, new Date(query.before)) : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(query.limit);
  const acks = await acknowledgementsFor(ctx.db, [...new Set(rows.map((r) => r.groupKey).filter((g): g is string => !!g))]);
  return {
    notifications: rows.map((n) => ({ ...n, acknowledgedBy: n.groupKey ? (acks.get(n.groupKey) ?? []) : [] })),
    unreadCount: await unreadCount(ctx.db, ctx.userId),
  };
}

export async function unreadCount(db: DbOrTx, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row.n;
}

async function loadOwn(ctx: ServiceContext, notificationId: string) {
  if (!uuidSchema.safeParse(notificationId).success) throw new AppError("not_found", "Notification not found.");
  const [row] = await ctx.db
    .select({ id: notifications.id, readAt: notifications.readAt, acknowledgedAt: notifications.acknowledgedAt })
    .from(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, ctx.userId)));
  if (!row) throw new AppError("not_found", "Notification not found.");
  return row;
}

export async function markRead(ctx: ServiceContext, notificationId: string) {
  const n = await loadOwn(ctx, notificationId);
  if (!n.readAt) await ctx.db.update(notifications).set({ readAt: ctx.now }).where(eq(notifications.id, n.id));
}

export async function markAllRead(ctx: ServiceContext) {
  await ctx.db
    .update(notifications)
    .set({ readAt: ctx.now })
    .where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt)));
}

/** "I'm checking on it": visible to everyone else who got an alert about the same event. */
export async function acknowledge(ctx: ServiceContext, notificationId: string) {
  const n = await loadOwn(ctx, notificationId);
  if (!n.acknowledgedAt) {
    await ctx.db
      .update(notifications)
      .set({ acknowledgedAt: ctx.now, readAt: n.readAt ?? ctx.now })
      .where(eq(notifications.id, n.id));
  }
}

// ── Preferences ────────────────────────────────────────────────────────────────────────────

const quietTime = z.string().regex(LOCAL_TIME_PATTERN, "Use 24-hour times like 22:00.").nullable();

export const preferencesSchema = z
  // digestEnabled is optional so clients that predate it don't switch the digest off by omission.
  .object({ emailEnabled: z.boolean(), quietStart: quietTime, quietEnd: quietTime, digestEnabled: z.boolean().optional() })
  .refine((v) => (v.quietStart === null) === (v.quietEnd === null), {
    message: "Set both a start and an end for quiet hours, or neither.",
    path: ["quietEnd"],
  });

export type Preferences = Required<z.infer<typeof preferencesSchema>>;
export const DEFAULT_PREFERENCES: Preferences = { emailEnabled: true, quietStart: null, quietEnd: null, digestEnabled: true };

export async function getPreferences(db: DbOrTx, userId: string): Promise<Preferences> {
  const [row] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  return row
    ? { emailEnabled: row.emailEnabled, quietStart: row.quietStart, quietEnd: row.quietEnd, digestEnabled: row.digestEnabled }
    : DEFAULT_PREFERENCES;
}

export async function updatePreferences(ctx: ServiceContext, input: z.infer<typeof preferencesSchema>): Promise<Preferences> {
  const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  await ctx.db
    .insert(notificationPreferences)
    .values({ userId: ctx.userId, ...set, updatedAt: ctx.now })
    .onConflictDoUpdate({ target: notificationPreferences.userId, set: { ...set, updatedAt: ctx.now } });
  return getPreferences(ctx.db, ctx.userId);
}

// ── Per-circle alert choices ───────────────────────────────────────────────────────────────

export const alertSettingsSchema = z
  .object({ doseReminders: z.boolean(), unconfirmedDoses: z.boolean(), refills: z.boolean(), appointments: z.boolean(), tasks: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

export async function getMyAlertSettings(ctx: ServiceContext, circleId: string) {
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  const [m] = await ctx.db.select().from(memberships).where(eq(memberships.id, access.membership.id));
  return {
    settings: effectiveAlertSettings(m.role, m),
    // The choices that can make a difference for this person: alerts only reach people allowed to
    // see what they're about (e.g. medicines the parent shares), and only some roles get each kind.
    available: ALERT_KINDS.filter((k) => offersChoice(m.role, k) && access.can(ALERT_CAPABILITY[k])),
    canReceiveMedicationAlerts: access.can("medication.view"),
  };
}

export async function updateMyAlertSettings(ctx: ServiceContext, circleId: string, input: z.infer<typeof alertSettingsSchema>) {
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  requireWritable(access);
  const set = Object.fromEntries(
    ALERT_KINDS.filter((k) => input[k] !== undefined).map((k) => [alertColumn(k), input[k]]),
  ) as Partial<typeof memberships.$inferInsert>;
  await ctx.db.update(memberships).set(set).where(eq(memberships.id, access.membership.id));
  return getMyAlertSettings(ctx, circleId);
}
