// "Today" summaries that the dashboards are built on. Each section appears only if the viewer may
// see it. Nothing here concludes that the care recipient is fine: the summary reports what has been
// recorded and when, and lists what needs someone's attention.

import { and, count, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { assistanceRequests, careUpdates, doseEventHistory, notifications, tasks, users, visits } from "@/server/db/schema";
import { needsRefill } from "@/server/domain/doses";
import { localDateIn, localDayBounds } from "@/server/domain/schedule";
import { authorize, type CircleAccess, type ServiceContext } from "./access";
import { listAppointments } from "./appointments";
import { listMyCircles } from "./circles";
import { listDoses } from "./doses";
import { listMedications } from "./medications";
import { listTasks } from "./tasks";
import { latestHandover, listVisits } from "./visits";

export type AttentionItem =
  | { kind: "dose_unconfirmed"; count: number }
  | { kind: "needs_driver"; appointmentId: string; title: string; startsAt: Date }
  | { kind: "unassigned_task"; count: number }
  | { kind: "overdue_task"; count: number }
  | { kind: "low_stock"; medicationId: string; name: string; supplyCount: number }
  | { kind: "visit_not_checked_in"; visitId: string; visitor: string | null; plannedStart: Date }
  | { kind: "open_help_request"; requestId: string; status: string; raisedAt: Date };

const APPOINTMENT_WINDOW_DAYS = 7;
const DRIVER_ATTENTION_HOURS = 72;

/** The most recent thing anyone recorded (a dose, a visit, an update) — never a verdict. */
async function lastRecordedActivity(ctx: ServiceContext, access: CircleAccess) {
  const circleId = access.circle.id;
  const candidates: { kind: "dose" | "visit" | "update"; at: Date; by: string | null }[] = [];
  if (access.can("medication.view")) {
    const [d] = await ctx.db
      .select({ at: doseEventHistory.recordedAt, by: users.name })
      .from(doseEventHistory)
      .leftJoin(users, eq(users.id, doseEventHistory.recordedBy))
      .where(eq(doseEventHistory.circleId, circleId))
      .orderBy(desc(doseEventHistory.recordedAt))
      .limit(1);
    if (d) candidates.push({ kind: "dose", at: d.at, by: d.by });
  }
  const at = sql<Date>`coalesce(${visits.checkedOutAt}, ${visits.checkedInAt})`;
  const [v] = await ctx.db
    .select({ at: at.mapWith(visits.plannedStart), by: users.name })
    .from(visits)
    .leftJoin(users, eq(users.id, visits.createdBy))
    .where(and(eq(visits.circleId, circleId), inArray(visits.status, ["in_progress", "completed"])))
    .orderBy(desc(at))
    .limit(1);
  if (v) candidates.push({ kind: "visit", at: v.at, by: v.by });
  const [u] = await ctx.db
    .select({ at: careUpdates.createdAt, by: users.name })
    .from(careUpdates)
    .leftJoin(users, eq(users.id, careUpdates.authorUserId))
    .where(and(eq(careUpdates.circleId, circleId), eq(careUpdates.category, "general")))
    .orderBy(desc(careUpdates.createdAt))
    .limit(1);
  if (u) candidates.push({ kind: "update", at: u.at, by: u.by });
  candidates.sort((a, b) => b.at.getTime() - a.at.getTime());
  return candidates[0] ?? null;
}

export async function getCircleToday(ctx: ServiceContext, circleId: string) {
  const access = await authorize(ctx, circleId, "circle.view");
  const tz = access.profile.timeZone;
  const localDate = localDateIn(tz, ctx.now);
  const attention: AttentionItem[] = [];

  let medicines = null;
  if (access.can("medication.view")) {
    const [day, meds] = await Promise.all([listDoses(ctx, circleId, { date: localDate, days: 1 }), listMedications(ctx, circleId)]);
    const counts = { upcoming: 0, due: 0, taken: 0, administered: 0, skipped: 0, refused: 0, unconfirmed: 0 };
    for (const d of day.doses) {
      if (d.status === "scheduled") counts[d.scheduledFor && d.scheduledFor > ctx.now ? "upcoming" : "due"]++;
      else counts[d.status]++;
    }
    const unconfirmed = day.doses.filter((d) => d.status === "unconfirmed");
    const lowStock = meds.filter((m) => needsRefill(m.supplyCount, m.refillThreshold));
    if (unconfirmed.length > 0) attention.push({ kind: "dose_unconfirmed", count: unconfirmed.length });
    for (const m of lowStock) attention.push({ kind: "low_stock", medicationId: m.id, name: m.name, supplyCount: m.supplyCount! });
    medicines = {
      counts,
      next: day.doses.filter((d) => d.status === "scheduled").slice(0, 5),
      unconfirmed,
      lowStock: lowStock.map((m) => ({ id: m.id, name: m.name, supplyCount: m.supplyCount })),
    };
  }

  let appointments = null;
  if (access.can("appointment.view")) {
    const horizon = ctx.now.getTime() + APPOINTMENT_WINDOW_DAYS * 24 * 3_600_000;
    const upcoming = (await listAppointments(ctx, circleId, { range: "upcoming", limit: 20 })).filter(
      (a) => a.status === "scheduled" && a.startsAt.getTime() >= ctx.now.getTime() && a.startsAt.getTime() <= horizon,
    );
    for (const a of upcoming) {
      if (a.transportNeeded && !a.transport && a.startsAt.getTime() - ctx.now.getTime() <= DRIVER_ATTENTION_HOURS * 3_600_000) {
        attention.push({ kind: "needs_driver", appointmentId: a.id, title: a.title, startsAt: a.startsAt });
      }
    }
    appointments = { upcoming: upcoming.slice(0, 5) };
  }

  let taskSummary = null;
  if (access.can("task.view")) {
    const [mine, unassigned, [{ overdue }]] = await Promise.all([
      listTasks(ctx, circleId, { status: "open", assignee: "me" }),
      listTasks(ctx, circleId, { status: "open", assignee: "unassigned" }),
      ctx.db
        .select({ overdue: count() })
        .from(tasks)
        .where(and(eq(tasks.circleId, circleId), eq(tasks.status, "open"), lt(tasks.dueAt, ctx.now))),
    ]);
    if (unassigned.length > 0) attention.push({ kind: "unassigned_task", count: unassigned.length });
    if (overdue > 0) attention.push({ kind: "overdue_task", count: overdue });
    taskSummary = { mine: mine.slice(0, 5), unassigned: unassigned.slice(0, 5), unassignedCount: unassigned.length, overdueCount: overdue };
  }

  let visitSummary = null;
  if (access.can("update.view")) {
    const { start, end } = localDayBounds(localDate, tz);
    const today = (await listVisits(ctx, circleId, "upcoming")).filter(
      (v) => (v.plannedStart >= start && v.plannedStart < end) || v.status === "in_progress",
    );
    for (const v of today) {
      if (v.status === "planned" && v.plannedStart.getTime() < ctx.now.getTime() - 30 * 60_000) {
        attention.push({ kind: "visit_not_checked_in", visitId: v.id, visitor: v.visitor?.name ?? null, plannedStart: v.plannedStart });
      }
    }
    visitSummary = { today, latestHandover: await latestHandover(ctx, circleId) };
  }

  let emergency = null;
  if (access.can("emergency.view")) {
    const [open] = await ctx.db
      .select({ id: assistanceRequests.id, status: assistanceRequests.status, raisedAt: assistanceRequests.createdAt, isPractice: assistanceRequests.isPractice })
      .from(assistanceRequests)
      .where(and(eq(assistanceRequests.circleId, circleId), inArray(assistanceRequests.status, ["open", "acknowledged"])))
      .orderBy(desc(assistanceRequests.createdAt))
      .limit(1);
    // A real open request goes first: it outranks everything else on the dashboard.
    if (open && !open.isPractice) attention.unshift({ kind: "open_help_request", requestId: open.id, status: open.status, raisedAt: open.raisedAt });
    emergency = { openRequest: open ?? null, emergencyNumber: access.profile.emergencyNumber };
  }

  return {
    circle: {
      id: access.circle.id,
      name: access.circle.name,
      status: access.circle.status,
      recipientName: access.profile.preferredName ?? access.profile.displayName,
      timeZone: tz,
      localDate,
      myRole: access.membership.role,
    },
    attention,
    lastRecordedActivity: access.can("update.view") ? await lastRecordedActivity(ctx, access) : null,
    medicines,
    appointments,
    tasks: taskSummary,
    visits: visitSummary,
    emergency,
  };
}

/** One glance across every circle the user belongs to, for the home page. */
export async function getMyToday(ctx: ServiceContext) {
  const circles = await listMyCircles(ctx);
  const summaries = [];
  for (const c of circles.filter((x) => x.status === "active")) {
    const today = await getCircleToday(ctx, c.id);
    summaries.push({
      circle: today.circle,
      attention: today.attention,
      lastRecordedActivity: today.lastRecordedActivity,
      myOpenTasks: today.tasks?.mine.length ?? 0,
      openHelpRequest: today.emergency?.openRequest && !today.emergency.openRequest.isPractice ? today.emergency.openRequest : null,
    });
  }
  const [{ unread }] = await ctx.db
    .select({ unread: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt)));
  return { circles: summaries, unreadNotifications: unread };
}
