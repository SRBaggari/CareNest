// Reports for a chosen period: a printable summary to take to the doctor, and a CSV of readings.
// Each section follows the reader's permissions and the parent's sharing choices, exactly like the
// pages it summarises. Only recorded facts are reported: no scores, percentages or interpretation.

import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { careUpdates, doseEvents, measurements, medications, users } from "@/server/db/schema";
import { resolvePeriod, tallyDoses, toCsv, type DoseTally, type ReportPeriod } from "@/server/domain/reports";
import { localDateIn, localDayBounds } from "@/server/domain/schedule";
import { AppError } from "@/server/http";
import { loadCircleAccess, type CircleAccess, type ServiceContext } from "./access";
import { recordAudit } from "./audit";
import { visibleCategories } from "./updates";

/** Loose here: resolvePeriod gives friendlier messages than a schema would. */
export const reportQuerySchema = z.object({
  from: z.string().max(20).optional(),
  to: z.string().max(20).optional(),
});

const recorder = alias(users, "recorder");
const author = alias(users, "author");

/** A report needs at least one of the things it reports on; outsiders get 404 from loadCircleAccess. */
async function reportAccess(ctx: ServiceContext, circleId: string) {
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  if (!access.can("medication.view") && !access.can("health.view")) {
    throw new AppError("forbidden", "You don't have permission to see reports in this care circle.");
  }
  return access;
}

function periodFor(access: CircleAccess, query: z.infer<typeof reportQuerySchema>, now: Date) {
  const tz = access.profile.timeZone;
  const resolved = resolvePeriod(query, localDateIn(tz, now));
  if (!resolved.ok) throw new AppError("validation_failed", "Some fields are invalid.", resolved.errors);
  const { from, to } = resolved.period;
  return { period: resolved.period, start: localDayBounds(from, tz).start, end: localDayBounds(to, tz).end };
}

async function readingsIn(ctx: ServiceContext, circleId: string, start: Date, end: Date) {
  const rows = await ctx.db
    .select({
      id: measurements.id,
      kind: measurements.kind,
      value: measurements.value,
      value2: measurements.value2,
      unit: measurements.unit,
      context: measurements.context,
      measuredAt: measurements.measuredAt,
      source: measurements.source,
      note: measurements.note,
      recordedBy: { id: recorder.id, name: recorder.name },
    })
    .from(measurements)
    .leftJoin(recorder, eq(recorder.id, measurements.recordedBy))
    .where(and(eq(measurements.circleId, circleId), isNull(measurements.removedAt), gte(measurements.measuredAt, start), lt(measurements.measuredAt, end)))
    .orderBy(asc(measurements.measuredAt))
    .limit(2000);
  return rows.map((r) => ({ ...r, recordedBy: r.recordedBy?.id ? r.recordedBy : null }));
}

export type MedicineSummary = {
  id: string;
  name: string;
  dosage: string;
  instructions: string | null;
  prescriber: string | null;
  asNeeded: boolean;
  scheduleTimes: string[];
  startDate: string;
  status: "active" | "stopped";
  stoppedAt: Date | null;
  doses: DoseTally;
};

/** Callers check `medication.view` first (the report and the assistant do). */
export async function medicinesIn(ctx: ServiceContext, circleId: string, period: ReportPeriod, start: Date, end: Date): Promise<MedicineSummary[]> {
  const [meds, doses] = await Promise.all([
    ctx.db
      .select()
      .from(medications)
      .where(
        and(
          eq(medications.circleId, circleId),
          lte(medications.startDate, period.to),
          or(isNull(medications.endDate), gte(medications.endDate, period.from)),
          or(isNull(medications.stoppedAt), gte(medications.stoppedAt, start)),
        ),
      )
      .orderBy(asc(medications.name)),
    ctx.db
      .select({ medicationId: doseEvents.medicationId, status: doseEvents.status, scheduledFor: doseEvents.scheduledFor })
      .from(doseEvents)
      .where(
        and(
          eq(doseEvents.circleId, circleId),
          or(
            and(gte(doseEvents.scheduledFor, start), lt(doseEvents.scheduledFor, end)),
            and(isNull(doseEvents.scheduledFor), gte(doseEvents.occurredAt, start), lt(doseEvents.occurredAt, end)),
          ),
          // Doses not yet due are not part of what happened in the period.
          or(isNull(doseEvents.scheduledFor), lt(doseEvents.scheduledFor, ctx.now)),
        ),
      ),
  ]);
  const tallies = tallyDoses(doses.map((d) => ({ medicationId: d.medicationId, status: d.status, scheduled: d.scheduledFor !== null })));
  return meds.map((m) => ({
    id: m.id,
    name: m.name,
    dosage: m.dosage,
    instructions: m.instructions,
    prescriber: m.prescriber,
    asNeeded: m.asNeeded,
    scheduleTimes: m.scheduleTimes,
    startDate: m.startDate,
    status: m.status,
    stoppedAt: m.stoppedAt,
    doses: tallies.get(m.id) ?? { scheduled: 0, taken: 0, administered: 0, skipped: 0, refused: 0, unconfirmed: 0, pending: 0, asNeeded: 0 },
  }));
}

/** Notes from the period; one that a later note corrects is left out (the correction is included). */
async function notesIn(ctx: ServiceContext, access: CircleAccess, start: Date, end: Date) {
  return ctx.db
    .select({ id: careUpdates.id, body: careUpdates.body, category: careUpdates.category, important: careUpdates.important, createdAt: careUpdates.createdAt, author: { name: author.name } })
    .from(careUpdates)
    .leftJoin(author, eq(author.id, careUpdates.authorUserId))
    .where(
      and(
        eq(careUpdates.circleId, access.circle.id),
        inArray(careUpdates.category, visibleCategories(access)),
        gte(careUpdates.createdAt, start),
        lt(careUpdates.createdAt, end),
        sql`not exists (select 1 from care_updates c where c.corrects_update_id = ${careUpdates.id})`,
      ),
    )
    .orderBy(desc(careUpdates.createdAt))
    .limit(50);
}

/** The "for the doctor" summary. Sections the reader may not see are null, not empty. */
export async function doctorSummary(ctx: ServiceContext, circleId: string, query: z.infer<typeof reportQuerySchema>) {
  const access = await reportAccess(ctx, circleId);
  const { period, start, end } = periodFor(access, query, ctx.now);
  const [medicines, readings, notes, [me]] = await Promise.all([
    access.can("medication.view") ? medicinesIn(ctx, circleId, period, start, end) : null,
    access.can("health.view") ? readingsIn(ctx, circleId, start, end) : null,
    access.can("update.view") ? notesIn(ctx, access, start, end) : null,
    ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId)),
  ]);
  await recordAudit(ctx.db, { circleId, actorUserId: ctx.userId, action: "report.generated", entityType: "circle", entityId: circleId, metadata: { from: period.from, to: period.to }, now: ctx.now });
  return {
    recipient: { name: access.profile.displayName, preferredName: access.profile.preferredName, dateOfBirth: access.profile.dateOfBirth },
    timeZone: access.profile.timeZone,
    period,
    generatedAt: ctx.now,
    generatedBy: me?.name ?? null,
    medicines,
    readings,
    notes,
  };
}

const CSV_HEADER = ["measured_at_local", "kind", "value", "value2", "unit", "context", "source", "recorded_by", "note"];

/** Readings as CSV for a spreadsheet or another app. Column names are stable identifiers, not prose. */
export async function measurementsCsv(ctx: ServiceContext, circleId: string, query: z.infer<typeof reportQuerySchema>) {
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  if (!access.can("health.view")) throw new AppError("forbidden", "You don't have permission to see health details in this care circle.");
  const { period, start, end } = periodFor(access, query, ctx.now);
  const rows = await readingsIn(ctx, circleId, start, end);
  const local = new Intl.DateTimeFormat("sv-SE", { timeZone: access.profile.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const csv = toCsv([CSV_HEADER, ...rows.map((r) => [local.format(r.measuredAt), r.kind, r.value, r.value2, r.unit, r.context, r.source, r.recordedBy?.name, r.note])]);
  // "measurement." actions follow the health-sharing choice in the activity log.
  await recordAudit(ctx.db, { circleId, actorUserId: ctx.userId, action: "measurement.exported", entityType: "circle", entityId: circleId, metadata: { from: period.from, to: period.to, count: rows.length }, now: ctx.now });
  return { csv, period, count: rows.length };
}
