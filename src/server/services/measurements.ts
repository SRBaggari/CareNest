// Health readings and the parent's daily check-ins. Readings are health details: they follow the
// parent's "share health details" choice for both seeing and recording.

import { and, desc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { careUpdates, measurements, users } from "@/server/db/schema";
import { checkReading, MEASUREMENT_KINDS, SUGAR_CONTEXTS } from "@/server/domain/measurements";
import { localDateIn } from "@/server/domain/schedule";
import { AppError } from "@/server/http";
import { uuidSchema } from "@/server/validation";
import { authorize, type ServiceContext } from "./access";
import { recordAudit } from "./audit";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v || null);
// Forms send numbers as text; the API also takes numbers.
const number = z.union([z.number(), z.string().trim().min(1).transform(Number)]).refine(Number.isFinite, "Enter a number.");

export const recordMeasurementSchema = z.object({
  kind: z.enum(MEASUREMENT_KINDS),
  unit: z.string().trim().min(1).max(10),
  value: number,
  value2: number.nullable().optional().transform((v) => v ?? null),
  context: z.enum(SUGAR_CONTEXTS).nullable().optional().transform((v) => v ?? null),
  /** When it was measured; defaults to now. Can be entered later ("taken at 7, writing it at 9"). */
  measuredAt: z.iso.datetime({ offset: true, message: "Enter a valid date and time." }).optional(),
  note: optionalText(500),
});

export const listMeasurementsQuerySchema = z.object({
  kind: z.enum(MEASUREMENT_KINDS).optional(),
  days: z.coerce.number().int().min(1).max(730).default(90),
});

/** How far back a reading may be entered: older paper records belong in documents. */
const MAX_BACKDATE_DAYS = 365;

const recorder = alias(users, "recorder");

export async function recordMeasurement(ctx: ServiceContext, circleId: string, raw: z.input<typeof recordMeasurementSchema>) {
  const input = recordMeasurementSchema.parse(raw);
  const access = await authorize(ctx, circleId, "measurement.record", { write: true });
  const measuredAt = input.measuredAt ? new Date(input.measuredAt) : ctx.now;
  const details: Record<string, string[]> = {};
  if (measuredAt.getTime() > ctx.now.getTime() + 5 * 60_000) details.measuredAt = ["That time is in the future."];
  if (measuredAt.getTime() < ctx.now.getTime() - MAX_BACKDATE_DAYS * 24 * 3_600_000) details.measuredAt = ["That's more than a year ago."];
  if (input.context && input.kind !== "blood_sugar") details.context = ["Only blood sugar readings have a context."];
  const reading = checkReading(input.kind, input.unit, input.value, input.value2);
  if (!reading.ok) Object.assign(details, reading.errors);
  if (Object.keys(details).length > 0 || !reading.ok) throw new AppError("validation_failed", "Some fields are invalid.", details);

  const [row] = await ctx.db
    .insert(measurements)
    .values({
      circleId,
      kind: input.kind,
      value: reading.value,
      value2: reading.value2,
      unit: input.unit,
      context: input.context,
      measuredAt,
      recordedAt: ctx.now,
      recordedBy: ctx.userId,
      source: access.membership.role === "care_recipient" ? "self" : "proxy",
      note: input.note,
    })
    .returning({ id: measurements.id });
  return row;
}

export async function listMeasurements(ctx: ServiceContext, circleId: string, query: z.infer<typeof listMeasurementsQuerySchema>) {
  await authorize(ctx, circleId, "health.view");
  const since = new Date(ctx.now.getTime() - query.days * 24 * 3_600_000);
  const rows = await ctx.db
    .select({
      id: measurements.id,
      kind: measurements.kind,
      value: measurements.value,
      value2: measurements.value2,
      unit: measurements.unit,
      context: measurements.context,
      measuredAt: measurements.measuredAt,
      recordedAt: measurements.recordedAt,
      source: measurements.source,
      note: measurements.note,
      recordedBy: { id: recorder.id, name: recorder.name },
    })
    .from(measurements)
    .leftJoin(recorder, eq(recorder.id, measurements.recordedBy))
    .where(
      and(
        eq(measurements.circleId, circleId),
        isNull(measurements.removedAt),
        gte(measurements.measuredAt, since),
        lte(measurements.measuredAt, new Date(ctx.now.getTime() + 5 * 60_000)),
        query.kind ? eq(measurements.kind, query.kind) : undefined,
      ),
    )
    .orderBy(desc(measurements.measuredAt))
    .limit(500);
  return rows.map((r) => ({ ...r, recordedBy: r.recordedBy?.id ? r.recordedBy : null }));
}

/** A reading entered by mistake: hidden from lists and charts, with who removed it in the activity log. */
export async function removeMeasurement(ctx: ServiceContext, circleId: string, measurementId: string) {
  const access = await authorize(ctx, circleId, "measurement.record", { write: true });
  const notFound = () => new AppError("not_found", "That reading wasn't found.");
  if (!uuidSchema.safeParse(measurementId).success) throw notFound();
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(measurements)
      .where(and(eq(measurements.id, measurementId), eq(measurements.circleId, circleId), isNull(measurements.removedAt)))
      .for("update");
    if (!row) throw notFound();
    if (row.recordedBy !== ctx.userId && access.membership.role !== "admin") {
      throw new AppError("forbidden", "Only the person who recorded a reading, or an admin, can remove it.");
    }
    await tx.update(measurements).set({ removedAt: ctx.now, removedBy: ctx.userId }).where(eq(measurements.id, row.id));
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: "measurement.removed",
      entityType: "measurement",
      entityId: row.id,
      metadata: { kind: row.kind, measuredAt: row.measuredAt.toISOString() },
      now: ctx.now,
    });
  });
}

/** The parent's answers to "How are you today?" for recent days, one per day (the last answer counts). */
export async function listCheckins(ctx: ServiceContext, circleId: string, days = 14) {
  const access = await authorize(ctx, circleId, "update.view");
  const since = new Date(ctx.now.getTime() - days * 24 * 3_600_000);
  const rows = await ctx.db
    .select({ feeling: careUpdates.checkin, createdAt: careUpdates.createdAt })
    .from(careUpdates)
    .where(and(eq(careUpdates.circleId, circleId), isNotNull(careUpdates.checkin), gte(careUpdates.createdAt, since)))
    .orderBy(careUpdates.createdAt);
  const byDay = new Map<string, { date: string; feeling: "fine" | "unwell" | "need"; at: Date }>();
  for (const r of rows) {
    const date = localDateIn(access.profile.timeZone, r.createdAt);
    byDay.set(date, { date, feeling: r.feeling!, at: r.createdAt });
  }
  return [...byDay.values()];
}
