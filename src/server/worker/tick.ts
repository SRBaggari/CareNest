// One pass of background work. Safe to run repeatedly and concurrently: every step claims its
// rows with a conditional UPDATE … RETURNING, and notifications have unique dedupe keys.

import { and, eq, gt, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { CircleRole } from "@/server/auth/permissions";
import type { Db } from "@/server/db";
import { careCircles, careProfiles, doseEvents, medications } from "@/server/db/schema";
import { addDays, localDateIn } from "@/server/domain/schedule";
import { wantsAlert, type AlertKind } from "@/server/notifications/alert-settings";
import { appUrl, circleAudience, translatorFor } from "@/server/notifications/audience";
import { deliverPendingEmails } from "@/server/notifications/email";
import { escalateAssistance } from "@/server/services/assistance";
import { purgeExpiredData } from "@/server/services/data-rights";
import { runCoordinationSteps } from "./coordination";
import { ensureDoses, markUnconfirmed } from "@/server/services/doses";
import { acknowledgementsFor, notifyUsers, type NewNotification } from "@/server/services/notifications";

/** Reminders are only sent close to the dose time; after downtime we don't send stale reminders. */
export const REMINDER_WINDOW_MINUTES = 30;
/** How long after the first "unconfirmed" alert, with nobody checking, before escalating. */
export const ESCALATE_AFTER_MINUTES = 60;
/** Alerts are not raised for doses older than this (e.g. after a long outage). */
const ALERT_LOOKBACK_MS = 24 * 3_600_000;

type Recipient = { userId: string; role: CircleRole; locale: string; isLegalRepresentative: boolean };

type CircleInfo = { circleId: string; name: string; timeZone: string };

async function circleInfo(db: Db, circleId: string): Promise<CircleInfo> {
  const [p] = await db
    .select({ displayName: careProfiles.displayName, preferredName: careProfiles.preferredName, timeZone: careProfiles.timeZone })
    .from(careProfiles)
    .where(eq(careProfiles.circleId, circleId));
  return { circleId, name: p.preferredName ?? p.displayName, timeZone: p.timeZone };
}

/** Active members allowed to see medicines (respecting the recipient's sharing choices). */
async function medicationAudience(db: Db, circleId: string, now: Date) {
  return (await circleAudience(db, circleId, now)).filter((a) => a.can("medication.view"));
}

function subscribers(audience: Awaited<ReturnType<typeof medicationAudience>>, kind: AlertKind) {
  return audience.filter((a) => wantsAlert(a.role, a.overrides, kind));
}

const tFor = translatorFor;

/** 1. Keep two days of doses materialised and mark overdue ones unconfirmed, for every active circle. */
export async function prepareDoses(db: Db, now: Date) {
  const circles = await db
    .select({ id: careCircles.id, timeZone: careProfiles.timeZone, grace: careProfiles.doseGraceMinutes })
    .from(careCircles)
    .innerJoin(careProfiles, eq(careProfiles.circleId, careCircles.id))
    .where(eq(careCircles.status, "active"));
  for (const c of circles) {
    const today = localDateIn(c.timeZone, now);
    await ensureDoses(db, c.id, c.timeZone, today, addDays(today, 1));
    await markUnconfirmed(db, c.id, now, c.grace);
  }
  return circles.length;
}

async function claimDoses(db: Db, set: Partial<typeof doseEvents.$inferInsert>, where: ReturnType<typeof and>) {
  return db
    .update(doseEvents)
    .set(set)
    .where(and(where, sql`${doseEvents.circleId} in (select id from care_circles where status = 'active')`))
    .returning({
      id: doseEvents.id,
      circleId: doseEvents.circleId,
      medicationId: doseEvents.medicationId,
      localTime: doseEvents.localTime,
    });
}

async function medicineOf(db: Db, medicationId: string) {
  const [m] = await db.select({ name: medications.name, dosage: medications.dosage }).from(medications).where(eq(medications.id, medicationId));
  return m;
}

/** 2. Reminders at dose time to those who asked for them (by default the recipient and caregivers). */
export async function sendDoseReminders(db: Db, now: Date) {
  const claimed = await claimDoses(
    db,
    { reminderSentAt: now },
    and(
      eq(doseEvents.status, "scheduled"),
      isNull(doseEvents.reminderSentAt),
      lte(doseEvents.scheduledFor, now),
      gt(doseEvents.scheduledFor, new Date(now.getTime() - REMINDER_WINDOW_MINUTES * 60_000)),
    ),
  );
  for (const dose of claimed) {
    const [circle, med, audience] = await Promise.all([
      circleInfo(db, dose.circleId),
      medicineOf(db, dose.medicationId),
      medicationAudience(db, dose.circleId, now),
    ]);
    const link = `/app/circles/${dose.circleId}/medicines`;
    const items = subscribers(audience, "doseReminders").map((r) => {
      const t = tFor(r.locale);
      const self = r.role === "care_recipient";
      const vars = { name: circle.name, medicine: med.name, dosage: med.dosage, time: dose.localTime ?? "" };
      return {
        userId: r.userId,
        circleId: dose.circleId,
        kind: "dose_reminder",
        priority: "normal",
        title: t(self ? "notif.reminderSelfTitle" : "notif.reminderOtherTitle", vars),
        body: t(self ? "notif.reminderSelfBody" : "notif.reminderOtherBody", vars),
        link,
        groupKey: `dose:${dose.id}`,
        dedupeKey: `dose_reminder:${dose.id}:${r.userId}`,
        email: { subject: t("notif.reminderEmailSubject"), text: t("notif.reminderEmailBody", { link: appUrl(link) }) },
      } satisfies NewNotification & { email: unknown };
    });
    await notifyUsers(db, now, items);
  }
  return claimed.length;
}

function unconfirmedItems(
  dose: { id: string; circleId: string; localTime: string | null },
  circle: CircleInfo,
  med: { name: string; dosage: string },
  recipients: Recipient[],
  kind: "dose_unconfirmed" | "dose_escalated",
): (NewNotification & { email: { subject: string; text: string } })[] {
  const link = `/app/circles/${dose.circleId}/medicines`;
  const escalated = kind === "dose_escalated";
  return recipients.map((r) => {
    const t = tFor(r.locale);
    const vars = { name: circle.name, medicine: med.name, dosage: med.dosage, time: dose.localTime ?? "", link: appUrl(link) };
    return {
      userId: r.userId,
      circleId: dose.circleId,
      kind,
      priority: escalated ? "critical" : "high",
      title: t(escalated ? "notif.escalatedTitle" : "notif.unconfirmedTitle", vars),
      body: t(escalated ? "notif.escalatedBody" : "notif.unconfirmedBody", vars),
      link,
      // Same group for alert and escalation, so one "I'm checking" covers both.
      groupKey: `dose:${dose.id}`,
      dedupeKey: `${kind}:${dose.id}:${r.userId}`,
      email: {
        subject: t(escalated ? "notif.escalatedEmailSubject" : "notif.unconfirmedEmailSubject", vars),
        text: t(escalated ? "notif.escalatedEmailBody" : "notif.unconfirmedEmailBody", vars),
      },
    };
  });
}

/** 3. Tell the circle when a dose has become unconfirmed. Never phrased as "missed". */
export async function sendUnconfirmedAlerts(db: Db, now: Date) {
  const claimed = await claimDoses(
    db,
    { alertedAt: now },
    and(eq(doseEvents.status, "unconfirmed"), isNull(doseEvents.alertedAt), gt(doseEvents.scheduledFor, new Date(now.getTime() - ALERT_LOOKBACK_MS))),
  );
  for (const dose of claimed) {
    const [circle, med, audience] = await Promise.all([
      circleInfo(db, dose.circleId),
      medicineOf(db, dose.medicationId),
      medicationAudience(db, dose.circleId, now),
    ]);
    await notifyUsers(db, now, unconfirmedItems(dose, circle, med, subscribers(audience, "unconfirmedDoses"), "dose_unconfirmed"));
  }
  return claimed.length;
}

/**
 * 4. If a dose is still unconfirmed a while after the alert and nobody has said they're
 * checking, escalate to the admins and the legal representative (who cannot opt out of this)
 * as well as everyone subscribed to unconfirmed-dose alerts.
 */
export async function escalateUnconfirmed(db: Db, now: Date) {
  const claimed = await claimDoses(
    db,
    { escalatedAt: now },
    and(
      eq(doseEvents.status, "unconfirmed"),
      isNotNull(doseEvents.alertedAt),
      isNull(doseEvents.escalatedAt),
      lte(doseEvents.alertedAt, new Date(now.getTime() - ESCALATE_AFTER_MINUTES * 60_000)),
      gt(doseEvents.scheduledFor, new Date(now.getTime() - ALERT_LOOKBACK_MS)),
    ),
  );
  let escalated = 0;
  for (const dose of claimed) {
    const acks = await acknowledgementsFor(db, [`dose:${dose.id}`]);
    if ((acks.get(`dose:${dose.id}`) ?? []).length > 0) continue;
    const [circle, med, audience] = await Promise.all([
      circleInfo(db, dose.circleId),
      medicineOf(db, dose.medicationId),
      medicationAudience(db, dose.circleId, now),
    ]);
    const recipients = audience.filter(
      (a) => a.role === "admin" || a.isLegalRepresentative || (a.role !== "care_recipient" && wantsAlert(a.role, a.overrides, "unconfirmedDoses")),
    );
    await notifyUsers(db, now, unconfirmedItems(dose, circle, med, recipients, "dose_escalated"));
    escalated++;
  }
  return escalated;
}

/** 5. One alert each time a medicine's stock falls to its refill threshold. */
export async function sendRefillAlerts(db: Db, now: Date) {
  const claimed = await db
    .update(medications)
    .set({ refillAlertedAt: now })
    .where(
      and(
        eq(medications.status, "active"),
        isNull(medications.refillAlertedAt),
        isNotNull(medications.supplyCount),
        isNotNull(medications.refillThreshold),
        lte(medications.supplyCount, medications.refillThreshold),
        sql`${medications.circleId} in (select id from care_circles where status = 'active')`,
      ),
    )
    .returning({ id: medications.id, circleId: medications.circleId, name: medications.name, supplyCount: medications.supplyCount });
  for (const med of claimed) {
    const [circle, audience] = await Promise.all([circleInfo(db, med.circleId), medicationAudience(db, med.circleId, now)]);
    const link = `/app/circles/${med.circleId}/medicines`;
    await notifyUsers(
      db,
      now,
      subscribers(audience, "refills").map((r) => {
        const t = tFor(r.locale);
        const vars = { name: circle.name, medicine: med.name, count: med.supplyCount ?? 0, link: appUrl(link) };
        return {
          userId: r.userId,
          circleId: med.circleId,
          kind: "refill_needed",
          priority: "normal" as const,
          title: t("notif.refillTitle", vars),
          body: t("notif.refillBody", vars),
          link,
          groupKey: `refill:${med.id}`,
          dedupeKey: `refill:${med.id}:${now.toISOString()}:${r.userId}`,
          email: { subject: t("notif.refillEmailSubject", vars), text: t("notif.refillEmailBody", vars) },
        };
      }),
    );
  }
  return claimed.length;
}

export type TickSummary = {
  circles: number;
  assistanceEscalations: number;
  reminders: number;
  unconfirmedAlerts: number;
  escalations: number;
  refillAlerts: number;
  coordination: Awaited<ReturnType<typeof runCoordinationSteps>>;
  purged: Awaited<ReturnType<typeof purgeExpiredData>>;
  emails: { sent: number; failed: number; retried: number };
};

export async function runTick(db: Db, now: Date): Promise<TickSummary> {
  // Requests for help go first: they are the most time-critical work in a tick.
  const assistanceEscalations = await escalateAssistance(db, now);
  const circles = await prepareDoses(db, now);
  const reminders = await sendDoseReminders(db, now);
  const unconfirmedAlerts = await sendUnconfirmedAlerts(db, now);
  const escalations = await escalateUnconfirmed(db, now);
  const refillAlerts = await sendRefillAlerts(db, now);
  const coordination = await runCoordinationSteps(db, now);
  const emails = await deliverPendingEmails(db, now);
  const purged = await purgeExpiredData(db, now);
  return { circles, assistanceEscalations, reminders, unconfirmedAlerts, escalations, refillAlerts, coordination, emails, purged };
}
