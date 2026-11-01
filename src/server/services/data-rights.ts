// Data export, account deletion and retention.
//
// Care records belong to the care recipient's history, so deleting an account removes the person
// (their login, memberships, notifications, preferences) and anonymises their authorship, but
// keeps the medicine records, visits and notes they wrote for the family. Retention purges data
// that has no lasting value (expired sessions, old read notifications, delivered email records).

import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import {
  appointments,
  assistanceRequests,
  auditEvents,
  careCircles,
  careProfiles,
  careUpdates,
  doseEventHistory,
  doseEvents,
  emailOutbox,
  measurements,
  pushOutbox,
  pushSubscriptions,
  emergencyContacts,
  emergencyInfoCards,
  medications,
  memberships,
  notificationPreferences,
  notifications,
  rateLimits,
  sessions,
  tasks,
  users,
  visits,
} from "@/server/db/schema";
import { hasManager } from "@/server/auth/permissions";
import { verifyPassword } from "@/server/auth/password";
import { AppError } from "@/server/http";
import { authorize, type ServiceContext } from "./access";
import { listAuditEvents, recordAudit } from "./audit";
import { documentIndex } from "./documents";

export const EXPORT_FORMAT = "carenest-export/1";

/** Everything CareNest holds about the signed-in person (not the care records of others). */
export async function exportMyData(ctx: ServiceContext) {
  const [account] = await ctx.db
    .select({ id: users.id, email: users.email, name: users.name, locale: users.locale, timeZone: users.timeZone, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, ctx.userId));
  const [preferences, devices, alertDevices, circles, myNotifications, myUpdates, myDoseRecords, myAudit] = await Promise.all([
    ctx.db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, ctx.userId)),
    ctx.db
      .select({ createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt, userAgent: sessions.userAgent })
      .from(sessions)
      .where(eq(sessions.userId, ctx.userId)),
    ctx.db
      .select({ label: pushSubscriptions.label, createdAt: pushSubscriptions.createdAt, lastAlertDeliveredAt: pushSubscriptions.lastSuccessAt })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, ctx.userId)),
    ctx.db
      .select({ circle: careCircles.name, role: memberships.role, status: memberships.status, joinedAt: memberships.createdAt, expiresAt: memberships.expiresAt })
      .from(memberships)
      .innerJoin(careCircles, eq(careCircles.id, memberships.circleId))
      .where(eq(memberships.userId, ctx.userId)),
    ctx.db
      .select({ kind: notifications.kind, title: notifications.title, body: notifications.body, createdAt: notifications.createdAt, readAt: notifications.readAt, acknowledgedAt: notifications.acknowledgedAt })
      .from(notifications)
      .where(eq(notifications.userId, ctx.userId))
      .limit(1000),
    ctx.db.select({ body: careUpdates.body, category: careUpdates.category, createdAt: careUpdates.createdAt }).from(careUpdates).where(eq(careUpdates.authorUserId, ctx.userId)),
    ctx.db
      .select({ status: doseEventHistory.status, occurredAt: doseEventHistory.occurredAt, recordedAt: doseEventHistory.recordedAt, note: doseEventHistory.note })
      .from(doseEventHistory)
      .where(eq(doseEventHistory.recordedBy, ctx.userId)),
    ctx.db.select({ action: auditEvents.action, createdAt: auditEvents.createdAt }).from(auditEvents).where(eq(auditEvents.actorUserId, ctx.userId)),
  ]);
  return {
    format: EXPORT_FORMAT,
    exportedAt: ctx.now,
    account,
    notificationPreferences: preferences[0] ?? null,
    signedInDevices: devices,
    phoneAlertDevices: alertDevices,
    circles,
    notifications: myNotifications,
    updatesIWrote: myUpdates,
    doseRecordsIMade: myDoseRecords,
    myActions: myAudit,
  };
}

/**
 * The complete record of one circle, for the people who manage it (an admin, or a self-managing
 * recipient: it is their own record). Secrets — password and token hashes — are never included.
 */
export async function exportCircle(ctx: ServiceContext, circleId: string) {
  const access = await authorize(ctx, circleId, "circle.manage");
  const where = <T extends { circleId: unknown }>(t: T) => eq(t.circleId as never, circleId);
  // The export follows the same sharing choices as the screens: an admin can't download what the
  // person receiving care has chosen not to share with them.
  const meds = access.can("medication.view");
  const appts = access.can("appointment.view");
  const health = access.can("health.view");
  const none = Promise.resolve([] as never[]);
  const [members, medRows, doseRows, history, apptRows, taskRows, visitRows, updates, readings, card, contacts, requests, audit] = await Promise.all([
    ctx.db
      .select({ name: users.name, email: users.email, role: memberships.role, status: memberships.status, joinedAt: memberships.createdAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.circleId, circleId)),
    meds ? ctx.db.select().from(medications).where(where(medications)) : none,
    meds ? ctx.db.select().from(doseEvents).where(where(doseEvents)) : none,
    meds ? ctx.db.select().from(doseEventHistory).where(where(doseEventHistory)) : none,
    appts ? ctx.db.select().from(appointments).where(where(appointments)) : none,
    ctx.db.select().from(tasks).where(where(tasks)),
    ctx.db.select().from(visits).where(where(visits)),
    ctx.db.select().from(careUpdates).where(and(where(careUpdates), inArray(careUpdates.category, health ? ["general", "health", "mood"] : ["general"]))),
    health ? ctx.db.select().from(measurements).where(and(where(measurements), isNull(measurements.removedAt))) : none,
    ctx.db.select().from(emergencyInfoCards).where(where(emergencyInfoCards)),
    ctx.db.select().from(emergencyContacts).where(where(emergencyContacts)),
    ctx.db.select().from(assistanceRequests).where(where(assistanceRequests)),
    listAuditEvents(ctx, circleId, { limit: 200 }),
  ]);
  await recordAudit(ctx.db, { circleId, actorUserId: ctx.userId, action: "circle.exported", entityType: "care_circle", entityId: circleId, now: ctx.now });
  const { linkedUserId: _linked, ...profile } = access.profile;
  return {
    format: EXPORT_FORMAT,
    exportedAt: ctx.now,
    circle: { id: access.circle.id, name: access.circle.name, status: access.circle.status, createdAt: access.circle.createdAt },
    profile,
    members,
    /** Sections left out because the person receiving care doesn't share them with this admin. */
    withheld: [...(meds ? [] : ["medications", "doses"]), ...(appts ? [] : ["appointments"]), ...(health ? [] : ["health and mood notes", "visit notes", "health readings", "health documents"])],
    medications: medRows,
    doses: doseRows,
    doseHistory: history,
    appointments: apptRows,
    tasks: taskRows,
    visits: health ? visitRows : visitRows.map((v) => ({ ...v, observations: null, handoverNote: null, unresolvedIssues: null })),
    updates,
    healthReadings: readings,
    /** The list only; the files themselves can be downloaded one by one in CareNest. */
    healthDocuments: health ? await documentIndex(ctx, circleId) : [],
    emergencyInfo: card[0]?.info ?? {},
    emergencyContacts: contacts,
    helpRequests: requests,
    activityLog: audit,
  };
}

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Enter your password.").max(1000),
  confirm: z.literal("DELETE", { message: "Type DELETE to confirm." }),
});

/**
 * Deletes the signed-in account. Refused while the person is the last one able to manage a
 * circle, so a care recipient's circle is never left without anyone who can manage it.
 */
export async function deleteMyAccount(ctx: ServiceContext, input: z.infer<typeof deleteAccountSchema>) {
  const [me] = await ctx.db.select().from(users).where(eq(users.id, ctx.userId));
  if (!me || !(await verifyPassword(input.password, me.passwordHash))) {
    throw new AppError("validation_failed", "Some fields are invalid.", { password: ["Your password is incorrect."] });
  }

  await ctx.db.transaction(async (tx) => {
    const mine = await tx
      .select({ circleId: memberships.circleId, name: careCircles.name, status: careCircles.status, selfManaging: careProfiles.selfManaging })
      .from(memberships)
      .innerJoin(careCircles, eq(careCircles.id, memberships.circleId))
      .innerJoin(careProfiles, eq(careProfiles.circleId, memberships.circleId))
      .where(and(eq(memberships.userId, ctx.userId), eq(memberships.status, "active")));

    const blocking: string[] = [];
    for (const c of mine.filter((m) => m.status === "active")) {
      const remaining = (
        await tx
          .select({ role: memberships.role, expiresAt: memberships.expiresAt, userId: memberships.userId })
          .from(memberships)
          .where(and(eq(memberships.circleId, c.circleId), eq(memberships.status, "active")))
      )
        .filter((m) => m.userId !== ctx.userId)
        .map((m) => ({ role: m.role, active: !m.expiresAt || m.expiresAt.getTime() > ctx.now.getTime() }));
      if (!hasManager(remaining, { selfManaging: c.selfManaging })) blocking.push(c.name);
    }
    if (blocking.length > 0) {
      throw new AppError("conflict", `You're the only person who can manage: ${blocking.join(", ")}. Make someone else an admin, or archive the circle, first.`, {
        circles: blocking,
      });
    }

    for (const c of mine) {
      await recordAudit(tx, {
        circleId: c.circleId,
        actorUserId: null,
        action: "member.account_deleted",
        entityType: "membership",
        metadata: { name: me.name },
        now: ctx.now,
      });
    }
    await tx.update(careProfiles).set({ linkedUserId: null }).where(eq(careProfiles.linkedUserId, ctx.userId));
    // Pending emails to this address and per-email throttling counters are personal data too.
    await tx.delete(emailOutbox).where(and(eq(emailOutbox.toAddress, me.email), inArray(emailOutbox.status, ["pending", "sending", "failed"])));
    await tx.delete(rateLimits).where(eq(rateLimits.key, `login:email:${me.email}`));
    // Cascades remove sessions, memberships, notifications and preferences; authorship of care
    // records is set to null by the foreign keys ("someone" in the history).
    await tx.delete(users).where(eq(users.id, ctx.userId));
  });
}

export const RETENTION = {
  readNotificationsDays: 180,
  deliveredEmailDays: 30,
  deliveredPushDays: 30,
  rateLimitHours: 48,
};

/** Worker step: removes data whose purpose has passed. Care records and the audit log are kept. */
export async function purgeExpiredData(db: ServiceContext["db"], now: Date) {
  const days = (n: number) => new Date(now.getTime() - n * 24 * 3_600_000);
  const expiredSessions = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id });
  const oldNotifications = await db
    .delete(notifications)
    .where(and(isNotNull(notifications.readAt), lt(notifications.createdAt, days(RETENTION.readNotificationsDays))))
    .returning({ id: notifications.id });
  const oldEmails = await db
    .delete(emailOutbox)
    .where(and(or(eq(emailOutbox.status, "sent"), eq(emailOutbox.status, "logged"), eq(emailOutbox.status, "failed")), lt(emailOutbox.createdAt, days(RETENTION.deliveredEmailDays))))
    .returning({ id: emailOutbox.id });
  const oldPush = await db
    .delete(pushOutbox)
    .where(and(inArray(pushOutbox.status, ["sent", "failed"]), lt(pushOutbox.createdAt, days(RETENTION.deliveredPushDays))))
    .returning({ id: pushOutbox.id });
  const staleLimits = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, new Date(now.getTime() - RETENTION.rateLimitHours * 3_600_000)))
    .returning({ key: rateLimits.key });
  return { sessions: expiredSessions.length, notifications: oldNotifications.length, emails: oldEmails.length, pushAlerts: oldPush.length, rateLimits: staleLimits.length };
}
