import { and, asc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  canRecordStatus,
  CORRECTION_WINDOW_HOURS,
  doseSource,
  MAX_EARLY_RECORDING_MINUTES,
  RECORDABLE_STATUSES,
  supplyDelta,
} from "@/server/domain/doses";
import { addDays, expandSchedule, LOCAL_DATE_PATTERN, localDateIn, localDayBounds } from "@/server/domain/schedule";
import { doseEventHistory, doseEvents, medications, users } from "@/server/db/schema";
import { AppError } from "@/server/http";
import { uuidSchema } from "@/server/validation";
import { authorize, type DbOrTx, type ServiceContext } from "./access";
import { recordAudit } from "./audit";
import { loadMedication } from "./medications";

/** How far in the future an "occurred at" time may be (device clocks drift). */
const CLOCK_SKEW_MS = 5 * 60_000;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const listDosesQuerySchema = z.object({
  date: z.string().regex(LOCAL_DATE_PATTERN, "Use a date like 2026-11-14.").optional(),
  days: z.coerce.number().int().min(1).max(7).default(1),
});

export const recordDoseSchema = z.object({
  status: z.enum(RECORDABLE_STATUSES),
  /** When it actually happened; defaults to now for taken/administered. */
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  reason: optionalText(500),
  note: optionalText(1000),
  sideEffects: optionalText(1000),
});

export const recordAsNeededSchema = z.object({
  status: z.enum(["taken", "administered"]),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  note: optionalText(1000),
  sideEffects: optionalText(1000),
});

/**
 * Materialises scheduled doses for a range of the recipient's local dates. Idempotent: the
 * unique (medication, scheduled_for) key means repeated calls never create duplicates.
 */
export async function ensureDoses(db: DbOrTx, circleId: string, timeZone: string, fromDate: string, toDate: string) {
  const meds = await db
    .select()
    .from(medications)
    .where(and(eq(medications.circleId, circleId), eq(medications.asNeeded, false)));
  const rows = meds.flatMap((m) =>
    expandSchedule(
      { times: m.scheduleTimes, daysOfWeek: m.scheduleDays, startDate: m.startDate, endDate: m.endDate, asNeeded: m.asNeeded },
      timeZone,
      fromDate,
      toDate,
    )
      // A stopped medicine keeps the doses that were due before it was stopped, nothing after.
      .filter((o) => m.status === "active" || (m.stoppedAt !== null && o.scheduledFor.getTime() <= m.stoppedAt.getTime()))
      .map((o) => ({
        circleId,
        medicationId: m.id,
        scheduledFor: o.scheduledFor,
        localDate: o.localDate,
        localTime: o.localTime,
        shifted: o.shifted,
      })),
  );
  if (rows.length > 0) await db.insert(doseEvents).values(rows).onConflictDoNothing();
}

/** Scheduled doses with no answer after the grace period become "unconfirmed" (never "missed"). */
export async function markUnconfirmed(db: DbOrTx, circleId: string, now: Date, graceMinutes: number) {
  const cutoff = new Date(now.getTime() - graceMinutes * 60_000);
  await db
    .update(doseEvents)
    .set({ status: "unconfirmed" })
    .where(and(eq(doseEvents.circleId, circleId), eq(doseEvents.status, "scheduled"), lt(doseEvents.scheduledFor, cutoff)));
}

const recorder = alias(users, "recorder");

function doseColumns() {
  return {
    id: doseEvents.id,
    medicationId: doseEvents.medicationId,
    scheduledFor: doseEvents.scheduledFor,
    localDate: doseEvents.localDate,
    localTime: doseEvents.localTime,
    shifted: doseEvents.shifted,
    status: doseEvents.status,
    occurredAt: doseEvents.occurredAt,
    recordedAt: doseEvents.recordedAt,
    source: doseEvents.source,
    reason: doseEvents.reason,
    note: doseEvents.note,
    sideEffects: doseEvents.sideEffects,
    reminderSentAt: doseEvents.reminderSentAt,
    recordedBy: { id: recorder.id, name: recorder.name },
    medication: {
      name: medications.name,
      dosage: medications.dosage,
      instructions: medications.instructions,
      asNeeded: medications.asNeeded,
      status: medications.status,
    },
  };
}

/** Doses for one or more of the recipient's local days, generating any that don't exist yet. */
export async function listDoses(ctx: ServiceContext, circleId: string, query: z.infer<typeof listDosesQuerySchema>) {
  const access = await authorize(ctx, circleId, "medication.view");
  const tz = access.profile.timeZone;
  const fromDate = query.date ?? localDateIn(tz, ctx.now);
  const toDate = addDays(fromDate, query.days - 1);
  const start = localDayBounds(fromDate, tz).start;
  const end = localDayBounds(toDate, tz).end;

  if (access.circle.status === "active") {
    await ensureDoses(ctx.db, circleId, tz, fromDate, toDate);
    await markUnconfirmed(ctx.db, circleId, ctx.now, access.profile.doseGraceMinutes);
  }

  const doses = await ctx.db
    .select(doseColumns())
    .from(doseEvents)
    .innerJoin(medications, eq(medications.id, doseEvents.medicationId))
    .leftJoin(recorder, eq(recorder.id, doseEvents.recordedBy))
    .where(
      and(
        eq(doseEvents.circleId, circleId),
        or(
          and(gte(doseEvents.scheduledFor, start), lt(doseEvents.scheduledFor, end)),
          and(isNull(doseEvents.scheduledFor), gte(doseEvents.occurredAt, start), lt(doseEvents.occurredAt, end)),
        ),
      ),
    )
    .orderBy(asc(sql`coalesce(${doseEvents.scheduledFor}, ${doseEvents.occurredAt})`), asc(medications.name));

  return { timeZone: tz, fromDate, toDate, graceMinutes: access.profile.doseGraceMinutes, doses };
}

async function loadDose(db: DbOrTx, circleId: string, doseId: string, lock = false) {
  if (!uuidSchema.safeParse(doseId).success) throw new AppError("not_found", "Dose not found.");
  const query = db
    .select()
    .from(doseEvents)
    .where(and(eq(doseEvents.id, doseId), eq(doseEvents.circleId, circleId)))
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new AppError("not_found", "Dose not found.");
  return row;
}

async function getDoseView(db: DbOrTx, doseId: string) {
  const [row] = await db
    .select(doseColumns())
    .from(doseEvents)
    .innerJoin(medications, eq(medications.id, doseEvents.medicationId))
    .leftJoin(recorder, eq(recorder.id, doseEvents.recordedBy))
    .where(eq(doseEvents.id, doseId));
  return row;
}

function resolveOccurredAt(status: string, occurredAt: string | undefined, now: Date): Date | null {
  if (occurredAt) {
    const at = new Date(occurredAt);
    if (at.getTime() > now.getTime() + CLOCK_SKEW_MS) {
      throw new AppError("validation_failed", "Some fields are invalid.", { occurredAt: ["This time is in the future."] });
    }
    return at;
  }
  return status === "taken" || status === "administered" ? now : null;
}

async function adjustSupply(db: DbOrTx, medicationId: string, delta: number) {
  if (delta === 0) return;
  await db
    .update(medications)
    .set({ supplyCount: sql`greatest(0, ${medications.supplyCount} + ${delta})` })
    .where(and(eq(medications.id, medicationId), sql`${medications.supplyCount} is not null`));
}

/**
 * Records what happened to a scheduled dose. Recording again is a correction: allowed for a
 * limited window, kept in history, and audited. Stock is adjusted to match.
 */
export async function recordDose(ctx: ServiceContext, circleId: string, doseId: string, input: z.infer<typeof recordDoseSchema>) {
  const access = await authorize(ctx, circleId, "dose.record", { write: true });
  const role = access.membership.role;
  if (!canRecordStatus(role, input.status)) {
    throw new AppError("forbidden", "Only a caregiver or family member can record giving a dose.");
  }

  await ctx.db.transaction(async (tx) => {
    const dose = await loadDose(tx, circleId, doseId, true);
    if (dose.scheduledFor && dose.scheduledFor.getTime() > ctx.now.getTime() + MAX_EARLY_RECORDING_MINUTES * 60_000) {
      throw new AppError("conflict", "This dose isn't due yet. You can record it up to 2 hours before its time.");
    }
    const isCorrection = dose.recordedAt !== null;
    const anchor = dose.scheduledFor ?? dose.occurredAt ?? dose.createdAt;
    if (isCorrection && ctx.now.getTime() - anchor.getTime() > CORRECTION_WINDOW_HOURS * 3_600_000) {
      throw new AppError("conflict", `Doses can only be corrected within ${CORRECTION_WINDOW_HOURS} hours.`);
    }

    const occurredAt = resolveOccurredAt(input.status, input.occurredAt, ctx.now);
    const source = doseSource(role, input.status);
    await tx
      .update(doseEvents)
      .set({
        status: input.status,
        occurredAt,
        recordedAt: ctx.now,
        recordedBy: ctx.userId,
        source,
        reason: input.reason ?? null,
        note: input.note ?? null,
        sideEffects: input.sideEffects ?? null,
      })
      .where(eq(doseEvents.id, dose.id));
    await tx.insert(doseEventHistory).values({
      doseEventId: dose.id,
      circleId,
      status: input.status,
      previousStatus: dose.status,
      occurredAt,
      recordedAt: ctx.now,
      recordedBy: ctx.userId,
      source,
      reason: input.reason ?? null,
      note: input.note ?? null,
      sideEffects: input.sideEffects ?? null,
      isCorrection,
    });
    const med = await loadMedication(tx, circleId, dose.medicationId);
    await adjustSupply(tx, med.id, supplyDelta(dose.status, input.status, med.unitsPerDose));

    if (isCorrection) {
      await recordAudit(tx, {
        circleId,
        actorUserId: ctx.userId,
        action: "dose.corrected",
        entityType: "dose_event",
        entityId: dose.id,
        metadata: { name: med.name, from: dose.status, to: input.status },
        now: ctx.now,
      });
    }
  });
  return getDoseView(ctx.db, doseId);
}

/** Records an as-needed (PRN) dose, which has no schedule. */
export async function recordAsNeededDose(
  ctx: ServiceContext,
  circleId: string,
  medicationId: string,
  input: z.infer<typeof recordAsNeededSchema>,
) {
  const access = await authorize(ctx, circleId, "dose.record", { write: true });
  const role = access.membership.role;
  if (!canRecordStatus(role, input.status)) {
    throw new AppError("forbidden", "Only a caregiver or family member can record giving a dose.");
  }
  const doseId = await ctx.db.transaction(async (tx) => {
    const med = await loadMedication(tx, circleId, medicationId);
    if (!med.asNeeded) throw new AppError("conflict", "This medicine has a schedule; record its scheduled doses instead.");
    if (med.status !== "active") throw new AppError("conflict", "This medicine has been stopped.");

    const occurredAt = resolveOccurredAt(input.status, input.occurredAt, ctx.now)!;
    const source = doseSource(role, input.status);
    const values = {
      status: input.status,
      occurredAt,
      recordedAt: ctx.now,
      recordedBy: ctx.userId,
      source,
      note: input.note ?? null,
      sideEffects: input.sideEffects ?? null,
    };
    const [dose] = await tx
      .insert(doseEvents)
      .values({ circleId, medicationId, ...values, createdAt: ctx.now })
      .returning({ id: doseEvents.id });
    await tx.insert(doseEventHistory).values({ doseEventId: dose.id, circleId, previousStatus: "scheduled", ...values });
    await adjustSupply(tx, med.id, supplyDelta("scheduled", input.status, med.unitsPerDose));
    return dose.id;
  });
  return getDoseView(ctx.db, doseId);
}

export async function getDoseHistory(ctx: ServiceContext, circleId: string, doseId: string) {
  await authorize(ctx, circleId, "medication.view");
  await loadDose(ctx.db, circleId, doseId);
  return ctx.db
    .select({
      id: doseEventHistory.id,
      status: doseEventHistory.status,
      previousStatus: doseEventHistory.previousStatus,
      occurredAt: doseEventHistory.occurredAt,
      recordedAt: doseEventHistory.recordedAt,
      source: doseEventHistory.source,
      reason: doseEventHistory.reason,
      note: doseEventHistory.note,
      sideEffects: doseEventHistory.sideEffects,
      isCorrection: doseEventHistory.isCorrection,
      recordedBy: { id: users.id, name: users.name },
    })
    .from(doseEventHistory)
    .leftJoin(users, eq(users.id, doseEventHistory.recordedBy))
    .where(eq(doseEventHistory.doseEventId, doseId))
    .orderBy(asc(doseEventHistory.recordedAt));
}
