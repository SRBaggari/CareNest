// Worker steps that keep practical responsibilities from being silently forgotten:
// appointment reminders, "nobody is driving", task due / unassigned / overdue alerts.
// Each step claims rows with a conditional UPDATE so overlapping ticks can't double-notify.

import { and, eq, gt, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { appointments, careProfiles, memberships, tasks, users, visits } from "@/server/db/schema";
import { wantsAlert } from "@/server/notifications/alert-settings";
import { appUrl, circleAudience, translatorFor, type AudienceMember } from "@/server/notifications/audience";
import { notifyUsers, type NewNotification } from "@/server/services/notifications";

export const APPOINTMENT_REMINDER_HOURS = 24;
export const TRANSPORT_ALERT_HOURS = 72;
export const TASK_DUE_SOON_HOURS = 3;
export const TASK_UNASSIGNED_HOURS = 48;
export const TASK_OVERDUE_GRACE_HOURS = 24;

const H = 3_600_000;
const activeCircle = (col: typeof appointments.circleId | typeof tasks.circleId) =>
  sql`${col} in (select id from care_circles where status = 'active')`;

async function profileOf(db: Db, circleId: string) {
  const [p] = await db
    .select({ name: sql<string>`coalesce(${careProfiles.preferredName}, ${careProfiles.displayName})`, timeZone: careProfiles.timeZone })
    .from(careProfiles)
    .where(eq(careProfiles.circleId, circleId));
  return p;
}

function when(at: Date, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(at);
}

async function memberNames(db: Db, ids: (string | null)[]) {
  const wanted = ids.filter((i): i is string => !!i);
  if (wanted.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: memberships.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(inArray(memberships.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name]));
}

type Item = NewNotification & { email: { subject: string; text: string } };

function item(
  r: AudienceMember,
  base: { circleId: string; kind: string; priority: NewNotification["priority"]; link: string; groupKey: string; dedupe: string },
  text: { title: string; body: string; subject: string; email: string },
): Item {
  return {
    userId: r.userId,
    circleId: base.circleId,
    kind: base.kind,
    priority: base.priority,
    title: text.title,
    body: text.body,
    link: base.link,
    groupKey: base.groupKey,
    dedupeKey: `${base.dedupe}:${r.userId}`,
    email: { subject: text.subject, text: text.email },
  };
}

/** Reminder a day ahead to the recipient and whoever is driving or going along (or organisers if nobody is). */
export async function sendAppointmentReminders(db: Db, now: Date) {
  const claimed = await db
    .update(appointments)
    .set({ reminderSentAt: now })
    .where(
      and(
        eq(appointments.status, "scheduled"),
        isNull(appointments.reminderSentAt),
        gt(appointments.startsAt, now),
        lte(appointments.startsAt, new Date(now.getTime() + APPOINTMENT_REMINDER_HOURS * H)),
        activeCircle(appointments.circleId),
      ),
    )
    .returning();
  for (const a of claimed) {
    const [profile, audience, names] = await Promise.all([
      profileOf(db, a.circleId),
      circleAudience(db, a.circleId, now),
      memberNames(db, [a.transportMemberId, a.companionMemberId]),
    ]);
    const helpers = new Set([a.transportMemberId, a.companionMemberId].filter(Boolean));
    // Whoever is driving or going along always hears; the parent and organisers can opt out.
    const recipients = audience.filter(
      (m) =>
        m.can("appointment.view") &&
        (helpers.has(m.memberId) ||
          ((m.role === "care_recipient" || (helpers.size === 0 && m.can("appointment.manage") && m.role !== "clinician")) && wantsAlert(m.role, m.overrides, "appointments"))),
    );
    const link = `/app/circles/${a.circleId}/appointments`;
    await notifyUsers(
      db,
      now,
      recipients.map((r) => {
        const t = translatorFor(r.locale);
        const vars = {
          title: a.title,
          name: profile.name,
          when: when(a.startsAt, r.locale, profile.timeZone),
          link: appUrl(link),
          helpers: a.transportNeeded
            ? t("notif.apptHelpers", {
                driver: (a.transportMemberId && names.get(a.transportMemberId)) || t("notif.nobody"),
                companion: (a.companionMemberId && names.get(a.companionMemberId)) || t("notif.nobody"),
              })
            : "",
        };
        return item(
          r,
          { circleId: a.circleId, kind: "appointment_reminder", priority: "normal", link, groupKey: `appointment:${a.id}`, dedupe: `appointment_reminder:${a.id}:${a.startsAt.toISOString()}` },
          { title: t("notif.apptReminderTitle", vars), body: t("notif.apptReminderBody", vars), subject: t("notif.apptEmailSubject", vars), email: t("notif.apptEmailBody", vars) },
        );
      }),
    );
  }
  return claimed.length;
}

/** In-person appointment within 72 h with nobody driving: ask the family and organisers. */
export async function sendTransportAlerts(db: Db, now: Date) {
  const claimed = await db
    .update(appointments)
    .set({ transportAlertedAt: now })
    .where(
      and(
        eq(appointments.status, "scheduled"),
        eq(appointments.transportNeeded, true),
        isNull(appointments.transportMemberId),
        isNull(appointments.transportAlertedAt),
        gt(appointments.startsAt, now),
        lte(appointments.startsAt, new Date(now.getTime() + TRANSPORT_ALERT_HOURS * H)),
        activeCircle(appointments.circleId),
      ),
    )
    .returning();
  for (const a of claimed) {
    const [profile, audience] = await Promise.all([profileOf(db, a.circleId), circleAudience(db, a.circleId, now)]);
    const link = `/app/circles/${a.circleId}/appointments`;
    const recipients = audience.filter(
      (m) => m.can("appointment.view") && (m.role === "admin" || m.role === "family") && wantsAlert(m.role, m.overrides, "appointments"),
    );
    await notifyUsers(
      db,
      now,
      recipients.map((r) => {
        const t = translatorFor(r.locale);
        const vars = { title: a.title, name: profile.name, when: when(a.startsAt, r.locale, profile.timeZone), link: appUrl(link) };
        return item(
          r,
          { circleId: a.circleId, kind: "transport_needed", priority: "high", link, groupKey: `appointment:${a.id}`, dedupe: `transport_needed:${a.id}:${a.startsAt.toISOString()}` },
          { title: t("notif.transportTitle", vars), body: t("notif.transportBody", vars), subject: t("notif.transportEmailSubject", vars), email: t("notif.transportEmailBody", vars) },
        );
      }),
    );
  }
  return claimed.length;
}

async function taskTexts(db: Db, task: typeof tasks.$inferSelect, r: AudienceMember, now: Date) {
  const profile = await profileOf(db, task.circleId);
  const t = translatorFor(r.locale);
  const link = `/app/circles/${task.circleId}/tasks`;
  return { t, link, vars: { title: task.title, name: profile.name, when: task.dueAt ? when(task.dueAt, r.locale, profile.timeZone) : "", link: appUrl(link) }, now };
}

/** A gentle "due soon" to the person who took the task. */
export async function sendTaskDueReminders(db: Db, now: Date) {
  const claimed = await db
    .update(tasks)
    .set({ dueReminderSentAt: now })
    .where(
      and(
        eq(tasks.status, "open"),
        isNotNull(tasks.assigneeMemberId),
        isNull(tasks.dueReminderSentAt),
        isNotNull(tasks.dueAt),
        lte(tasks.dueAt, new Date(now.getTime() + TASK_DUE_SOON_HOURS * H)),
        gt(tasks.dueAt, new Date(now.getTime() - TASK_OVERDUE_GRACE_HOURS * H)),
        activeCircle(tasks.circleId),
      ),
    )
    .returning();
  for (const task of claimed) {
    const assignee = (await circleAudience(db, task.circleId, now)).find((m) => m.memberId === task.assigneeMemberId);
    if (!assignee) continue;
    const { t, link, vars } = await taskTexts(db, task, assignee, now);
    await notifyUsers(db, now, [
      item(
        assignee,
        { circleId: task.circleId, kind: "task_due", priority: "normal", link, groupKey: `task:${task.id}`, dedupe: `task_due:${task.id}:${task.dueAt!.toISOString()}` },
        { title: t("notif.taskDueTitle", vars), body: t("notif.taskDueBody", vars), subject: t("notif.taskEmailSubject", vars), email: t("notif.taskEmailBody", vars) },
      ),
    ]);
  }
  return claimed.length;
}

/** A task due within 48 h that nobody has taken: ask everyone who can take tasks on. */
export async function sendUnassignedTaskAlerts(db: Db, now: Date) {
  const claimed = await db
    .update(tasks)
    .set({ unassignedAlertedAt: now })
    .where(
      and(
        eq(tasks.status, "open"),
        isNull(tasks.assigneeMemberId),
        isNull(tasks.unassignedAlertedAt),
        isNotNull(tasks.dueAt),
        lte(tasks.dueAt, new Date(now.getTime() + TASK_UNASSIGNED_HOURS * H)),
        gt(tasks.dueAt, new Date(now.getTime() - TASK_OVERDUE_GRACE_HOURS * H)),
        activeCircle(tasks.circleId),
      ),
    )
    .returning();
  for (const task of claimed) {
    const audience = (await circleAudience(db, task.circleId, now)).filter(
      (m) => m.can("task.manage") && m.role !== "care_recipient" && wantsAlert(m.role, m.overrides, "tasks"),
    );
    const items: Item[] = [];
    for (const r of audience) {
      const { t, link, vars } = await taskTexts(db, task, r, now);
      items.push(
        item(
          r,
          { circleId: task.circleId, kind: "task_unassigned", priority: "high", link, groupKey: `task:${task.id}`, dedupe: `task_unassigned:${task.id}:${task.dueAt!.toISOString()}` },
          { title: t("notif.taskUnassignedTitle", vars), body: t("notif.taskUnassignedBody", vars), subject: t("notif.taskEmailSubject", vars), email: t("notif.taskEmailBody", vars) },
        ),
      );
    }
    await notifyUsers(db, now, items);
  }
  return claimed.length;
}

/** Still open a day after its due time: tell the assignee and the admins. */
export async function sendOverdueTaskAlerts(db: Db, now: Date) {
  const claimed = await db
    .update(tasks)
    .set({ overdueAlertedAt: now })
    .where(
      and(
        eq(tasks.status, "open"),
        isNull(tasks.overdueAlertedAt),
        isNotNull(tasks.dueAt),
        lte(tasks.dueAt, new Date(now.getTime() - TASK_OVERDUE_GRACE_HOURS * H)),
        gt(tasks.dueAt, new Date(now.getTime() - 14 * 24 * H)),
        activeCircle(tasks.circleId),
      ),
    )
    .returning();
  for (const task of claimed) {
    const audience = await circleAudience(db, task.circleId, now);
    const names = await memberNames(db, [task.assigneeMemberId]);
    // The person who took the task on always hears; admins can opt out.
    const recipients = audience.filter(
      (m) => m.memberId === task.assigneeMemberId || (m.role === "admin" && m.can("task.view") && wantsAlert(m.role, m.overrides, "tasks")),
    );
    const items: Item[] = [];
    for (const r of recipients) {
      const { t, link, vars } = await taskTexts(db, task, r, now);
      const who = task.assigneeMemberId
        ? t("notif.taskOverdueAssigned", { assignee: names.get(task.assigneeMemberId) ?? "" })
        : t("notif.taskOverdueUnassigned");
      items.push(
        item(
          r,
          { circleId: task.circleId, kind: "task_overdue", priority: "high", link, groupKey: `task:${task.id}`, dedupe: `task_overdue:${task.id}:${task.dueAt!.toISOString()}` },
          { title: t("notif.taskOverdueTitle", vars), body: t("notif.taskOverdueBody", { ...vars, who }), subject: t("notif.taskEmailSubject", vars), email: t("notif.taskEmailBody", vars) },
        ),
      );
    }
    await notifyUsers(db, now, items);
  }
  return claimed.length;
}

export const VISIT_CHECK_IN_GRACE_MINUTES = 30;

/**
 * A planned visit 30 minutes past its start with no check-in: remind the visitor, and let admins
 * and family know — carefully worded, because check-ins are self-reported.
 */
export async function sendVisitNotCheckedInAlerts(db: Db, now: Date) {
  const claimed = await db
    .update(visits)
    .set({ notCheckedInAlertedAt: now })
    .where(
      and(
        eq(visits.status, "planned"),
        isNull(visits.notCheckedInAlertedAt),
        lte(visits.plannedStart, new Date(now.getTime() - VISIT_CHECK_IN_GRACE_MINUTES * 60_000)),
        gt(visits.plannedStart, new Date(now.getTime() - 12 * H)),
        sql`${visits.circleId} in (select id from care_circles where status = 'active')`,
      ),
    )
    .returning();
  for (const v of claimed) {
    const [profile, audience, names] = await Promise.all([profileOf(db, v.circleId), circleAudience(db, v.circleId, now), memberNames(db, [v.visitorMemberId])]);
    const visitorName = (v.visitorMemberId && names.get(v.visitorMemberId)) || "";
    const link = `/app/circles/${v.circleId}/visits`;
    const items: Item[] = [];
    for (const r of audience) {
      const isVisitor = r.memberId === v.visitorMemberId;
      if (!isVisitor && !(r.role === "admin" || r.role === "family")) continue;
      const t = translatorFor(r.locale);
      const vars = {
        visitor: visitorName,
        name: profile.name,
        time: new Intl.DateTimeFormat(r.locale, { hour: "2-digit", minute: "2-digit", timeZone: profile.timeZone }).format(v.plannedStart),
        link: appUrl(link),
      };
      items.push(
        item(
          r,
          { circleId: v.circleId, kind: "visit_not_checked_in", priority: isVisitor ? "normal" : "high", link, groupKey: `visit:${v.id}`, dedupe: `visit_not_checked_in:${v.id}` },
          {
            title: t(isVisitor ? "notif.visitCheckInReminderTitle" : "notif.visitNotCheckedInTitle", vars),
            body: t(isVisitor ? "notif.visitCheckInReminderBody" : "notif.visitNotCheckedInBody", vars),
            subject: t("notif.visitEmailSubject", vars),
            email: t("notif.visitEmailBody", vars),
          },
        ),
      );
    }
    await notifyUsers(db, now, items);
  }
  return claimed.length;
}

export async function runCoordinationSteps(db: Db, now: Date) {
  return {
    appointmentReminders: await sendAppointmentReminders(db, now),
    transportAlerts: await sendTransportAlerts(db, now),
    taskDue: await sendTaskDueReminders(db, now),
    taskUnassigned: await sendUnassignedTaskAlerts(db, now),
    taskOverdue: await sendOverdueTaskAlerts(db, now),
    visitNotCheckedIn: await sendVisitNotCheckedInAlerts(db, now),
  };
}
