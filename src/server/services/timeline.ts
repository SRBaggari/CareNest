// Unified care timeline: one chronological view across medicines, appointments, tasks, visits,
// updates and medicine changes. Each source is filtered by what the viewer may see, and every
// item names who recorded it and how (self-reported, reported on someone's behalf, caregiver).

import { and, desc, eq, ilike, inArray, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { appointments, auditEvents, careUpdates, doseEventHistory, doseEvents, medications, memberships, tasks, users, visits } from "@/server/db/schema";
import { authorize, type ServiceContext } from "./access";
import { visibleCategories } from "./updates";

export const TIMELINE_KINDS = ["dose", "appointment", "task", "visit", "update", "medication"] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export const timelineQuerySchema = z.object({
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  kinds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter((k): k is TimelineKind => (TIMELINE_KINDS as readonly string[]).includes(k)) : [...TIMELINE_KINDS])),
  q: z.string().trim().max(100).optional(),
});

export type TimelineItem = {
  id: string;
  kind: TimelineKind;
  /** When it happened (not when it was typed in). */
  at: Date;
  recordedAt: Date | null;
  actor: string | null;
  source: "self" | "proxy" | "caregiver" | null;
  isCorrection: boolean;
  data: Record<string, unknown>;
  link: string;
};

const actor = alias(users, "actor");

export async function getTimeline(ctx: ServiceContext, circleId: string, raw: z.input<typeof timelineQuerySchema>) {
  const query = timelineQuerySchema.parse(raw);
  const access = await authorize(ctx, circleId, "update.view");
  const before = query.before ? new Date(query.before) : new Date(ctx.now.getTime() + 60_000);
  const like = query.q ? `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const limit = query.limit;
  const base = `/app/circles/${circleId}`;
  const want = (k: TimelineKind) => query.kinds.includes(k);
  const search = (...cols: SQL.Aliased[] | Parameters<typeof ilike>[0][]) =>
    like ? or(...(cols as Parameters<typeof ilike>[0][]).map((c) => ilike(c, like))) : undefined;
  const items: TimelineItem[] = [];

  if (want("dose") && access.can("medication.view")) {
    const at = sql<Date>`coalesce(${doseEventHistory.occurredAt}, ${doseEventHistory.recordedAt})`;
    const rows = await ctx.db
      .select({
        id: doseEventHistory.id,
        at: at.mapWith(doseEventHistory.recordedAt),
        recordedAt: doseEventHistory.recordedAt,
        status: doseEventHistory.status,
        previousStatus: doseEventHistory.previousStatus,
        source: doseEventHistory.source,
        isCorrection: doseEventHistory.isCorrection,
        reason: doseEventHistory.reason,
        localTime: doseEvents.localTime,
        medicine: medications.name,
        dosage: medications.dosage,
        actor: actor.name,
      })
      .from(doseEventHistory)
      .innerJoin(doseEvents, eq(doseEvents.id, doseEventHistory.doseEventId))
      .innerJoin(medications, eq(medications.id, doseEvents.medicationId))
      .leftJoin(actor, eq(actor.id, doseEventHistory.recordedBy))
      .where(and(eq(doseEventHistory.circleId, circleId), lt(at, before), search(medications.name)))
      .orderBy(desc(at))
      .limit(limit);
    for (const r of rows) {
      items.push({
        id: `dose:${r.id}`,
        kind: "dose",
        at: r.at,
        recordedAt: r.recordedAt,
        actor: r.actor,
        source: r.source,
        isCorrection: r.isCorrection,
        data: { status: r.status, previousStatus: r.previousStatus, medicine: r.medicine, dosage: r.dosage, scheduledTime: r.localTime, reason: r.reason },
        link: `${base}/medicines`,
      });
    }
  }

  if (want("appointment") && access.can("appointment.view")) {
    const at = sql<Date>`coalesce(${appointments.outcomeAt}, ${appointments.cancelledAt})`;
    const rows = await ctx.db
      .select({
        id: appointments.id,
        at: at.mapWith(appointments.startsAt),
        status: appointments.status,
        title: appointments.title,
        startsAt: appointments.startsAt,
        outcomeNote: appointments.outcomeNote,
        cancelReason: appointments.cancelReason,
        actor: actor.name,
      })
      .from(appointments)
      .leftJoin(actor, eq(actor.id, sql`coalesce(${appointments.outcomeBy}, ${appointments.cancelledBy})`))
      .where(and(eq(appointments.circleId, circleId), inArray(appointments.status, ["completed", "cancelled"]), lt(at, before), search(appointments.title, appointments.outcomeNote)))
      .orderBy(desc(at))
      .limit(limit);
    for (const r of rows) {
      items.push({
        id: `appointment:${r.id}`,
        kind: "appointment",
        at: r.at,
        recordedAt: r.at,
        actor: r.actor,
        source: null,
        isCorrection: false,
        data: { status: r.status, title: r.title, startsAt: r.startsAt, outcomeNote: r.outcomeNote, cancelReason: r.cancelReason },
        link: `${base}/appointments`,
      });
    }
  }

  if (want("task") && access.can("task.view")) {
    const rows = await ctx.db
      .select({ id: tasks.id, at: tasks.completedAt, title: tasks.title, note: tasks.completionNote, actor: actor.name })
      .from(tasks)
      .leftJoin(actor, eq(actor.id, tasks.completedBy))
      .where(and(eq(tasks.circleId, circleId), eq(tasks.status, "done"), isNotNull(tasks.completedAt), lt(tasks.completedAt, before), search(tasks.title, tasks.completionNote)))
      .orderBy(desc(tasks.completedAt))
      .limit(limit);
    for (const r of rows) {
      items.push({ id: `task:${r.id}`, kind: "task", at: r.at!, recordedAt: r.at, actor: r.actor, source: null, isCorrection: false, data: { title: r.title, note: r.note }, link: `${base}/tasks` });
    }
  }

  if (want("visit")) {
    const showDetails = access.can("health.view");
    const at = sql<Date>`coalesce(${visits.checkedOutAt}, ${visits.checkedInAt})`;
    const visitor = alias(memberships, "tl_visitor");
    const rows = await ctx.db
      .select({
        id: visits.id,
        at: at.mapWith(visits.plannedStart),
        status: visits.status,
        checkedInAt: visits.checkedInAt,
        checkedOutAt: visits.checkedOutAt,
        observations: visits.observations,
        unresolvedIssues: visits.unresolvedIssues,
        actor: actor.name,
      })
      .from(visits)
      .leftJoin(visitor, eq(visitor.id, visits.visitorMemberId))
      .leftJoin(actor, eq(actor.id, visitor.userId))
      .where(
        and(
          eq(visits.circleId, circleId),
          inArray(visits.status, ["in_progress", "completed"]),
          lt(at, before),
          like ? (showDetails ? search(visits.observations, visits.handoverNote, visits.unresolvedIssues, actor.name) : search(actor.name)) : undefined,
        ),
      )
      .orderBy(desc(at))
      .limit(limit);
    for (const r of rows) {
      items.push({
        id: `visit:${r.id}`,
        kind: "visit",
        at: r.at,
        recordedAt: r.at,
        actor: r.actor,
        source: "self",
        isCorrection: false,
        data: {
          status: r.status,
          checkedInAt: r.checkedInAt,
          checkedOutAt: r.checkedOutAt,
          observations: showDetails ? r.observations : null,
          unresolvedIssues: showDetails ? r.unresolvedIssues : null,
          detailsHidden: !showDetails && Boolean(r.observations || r.unresolvedIssues),
        },
        link: `${base}/visits`,
      });
    }
  }

  if (want("update")) {
    const rows = await ctx.db
      .select({
        id: careUpdates.id,
        at: careUpdates.createdAt,
        body: careUpdates.body,
        category: careUpdates.category,
        important: careUpdates.important,
        corrects: careUpdates.correctsUpdateId,
        actor: actor.name,
      })
      .from(careUpdates)
      .leftJoin(actor, eq(actor.id, careUpdates.authorUserId))
      .where(and(eq(careUpdates.circleId, circleId), inArray(careUpdates.category, visibleCategories(access)), lt(careUpdates.createdAt, before), search(careUpdates.body)))
      .orderBy(desc(careUpdates.createdAt))
      .limit(limit);
    for (const r of rows) {
      items.push({
        id: `update:${r.id}`,
        kind: "update",
        at: r.at,
        recordedAt: r.at,
        actor: r.actor,
        source: null,
        isCorrection: r.corrects !== null,
        data: { body: r.body, category: r.category, important: r.important, correctsUpdateId: r.corrects },
        link: `${base}/updates`,
      });
    }
  }

  if (want("medication") && access.can("medication.view")) {
    const rows = await ctx.db
      .select({ id: auditEvents.id, at: auditEvents.createdAt, action: auditEvents.action, metadata: auditEvents.metadata, actor: actor.name })
      .from(auditEvents)
      .leftJoin(actor, eq(actor.id, auditEvents.actorUserId))
      .where(
        and(
          eq(auditEvents.circleId, circleId),
          inArray(auditEvents.action, ["medication.created", "medication.updated", "medication.stopped"]),
          lt(auditEvents.createdAt, before),
          like ? sql`${auditEvents.metadata}->>'name' ilike ${like}` : undefined,
        ),
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);
    for (const r of rows) {
      items.push({
        id: `medication:${r.id}`,
        kind: "medication",
        at: r.at,
        recordedAt: r.at,
        actor: r.actor,
        source: null,
        isCorrection: false,
        data: { action: r.action, name: (r.metadata as { name?: string }).name ?? null },
        link: `${base}/medicines`,
      });
    }
  }

  items.sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id));
  const page = items.slice(0, limit);
  return { items: page, nextBefore: page.length === limit ? page[page.length - 1].at.toISOString() : null };
}
