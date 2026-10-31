import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { needsRefill } from "@/server/domain/doses";
import { LOCAL_DATE_PATTERN, LOCAL_TIME_PATTERN, localDateIn } from "@/server/domain/schedule";
import { doseEvents, medications } from "@/server/db/schema";
import { AppError } from "@/server/http";
import { uuidSchema } from "@/server/validation";
import { authorize, type CircleAccess, type DbOrTx, type ServiceContext } from "./access";
import { recordAudit } from "./audit";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const localDate = z.string().regex(LOCAL_DATE_PATTERN, "Enter a valid date.");

const medicationFields = {
  name: z.string().trim().min(1, "Enter the medicine's name.").max(120),
  dosage: z.string().trim().min(1, "Enter the dose, e.g. “1 tablet (500 mg)”.").max(120),
  instructions: optionalText(1000),
  prescriber: optionalText(200),
  startDate: localDate,
  endDate: localDate.nullable(),
  asNeeded: z.boolean(),
  times: z
    .array(z.string().regex(LOCAL_TIME_PATTERN, "Use 24-hour times like 08:00."))
    .max(12, "At most 12 times a day."),
  daysOfWeek: z.array(z.int().min(1).max(7)).min(1, "Choose at least one day.").max(7).nullable(),
  unitsPerDose: z.int().min(1).max(20),
  supplyCount: z.int().min(0).max(100_000).nullable(),
  refillThreshold: z.int().min(0).max(100_000).nullable(),
};

type ScheduleCheck = { asNeeded?: boolean; times?: string[]; startDate?: string; endDate?: string | null };

function checkSchedule(v: ScheduleCheck, ctx: z.RefinementCtx) {
  if (v.asNeeded === false && v.times !== undefined && v.times.length === 0) {
    ctx.addIssue({ code: "custom", path: ["times"], message: "Add at least one time, or mark it as needed only." });
  }
  if (v.startDate && v.endDate && v.endDate < v.startDate) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "The end date must be on or after the start date." });
  }
}

export const createMedicationSchema = z
  .object({
    ...medicationFields,
    startDate: localDate.optional(),
    endDate: medicationFields.endDate.optional(),
    asNeeded: medicationFields.asNeeded.default(false),
    times: medicationFields.times.default([]),
    daysOfWeek: medicationFields.daysOfWeek.optional(),
    unitsPerDose: medicationFields.unitsPerDose.default(1),
    supplyCount: medicationFields.supplyCount.optional(),
    refillThreshold: medicationFields.refillThreshold.optional(),
  })
  .superRefine(checkSchedule);

export const updateMedicationSchema = z
  .object({ ...medicationFields, version: z.int().positive() })
  .partial()
  .required({ version: true })
  .superRefine(checkSchedule);

export const stopMedicationSchema = z.object({ reason: optionalText(500) });

export const restockSchema = z.object({ supplyCount: z.int().min(0).max(100_000) });

type MedicationRow = typeof medications.$inferSelect;

export function serializeMedication(m: MedicationRow) {
  return {
    id: m.id,
    name: m.name,
    dosage: m.dosage,
    instructions: m.instructions,
    prescriber: m.prescriber,
    startDate: m.startDate,
    endDate: m.endDate,
    asNeeded: m.asNeeded,
    times: [...m.scheduleTimes].sort(),
    daysOfWeek: m.scheduleDays,
    unitsPerDose: m.unitsPerDose,
    supplyCount: m.supplyCount,
    refillThreshold: m.refillThreshold,
    needsRefill: needsRefill(m.supplyCount, m.refillThreshold),
    status: m.status,
    stoppedAt: m.stoppedAt,
    stopReason: m.stopReason,
    version: m.version,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

/**
 * Removes future doses nobody has answered yet, so they are regenerated from the current
 * schedule (after a schedule change, a stop, or the recipient moving time zone). Recorded doses
 * and anything in the past are never touched.
 */
export async function clearFutureUnansweredDoses(
  db: DbOrTx,
  input: { circleId: string; medicationId?: string; after: Date },
): Promise<void> {
  await db
    .delete(doseEvents)
    .where(
      and(
        eq(doseEvents.circleId, input.circleId),
        input.medicationId ? eq(doseEvents.medicationId, input.medicationId) : undefined,
        inArray(doseEvents.status, ["scheduled"]),
        isNull(doseEvents.recordedAt),
        gt(doseEvents.scheduledFor, input.after),
      ),
    );
}

async function loadMedication(db: DbOrTx, circleId: string, medicationId: string): Promise<MedicationRow> {
  if (!uuidSchema.safeParse(medicationId).success) throw new AppError("not_found", "Medicine not found.");
  const [row] = await db
    .select()
    .from(medications)
    .where(and(eq(medications.id, medicationId), eq(medications.circleId, circleId)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Medicine not found.");
  return row;
}

export async function listMedications(ctx: ServiceContext, circleId: string, options: { includeStopped?: boolean } = {}) {
  await authorize(ctx, circleId, "medication.view");
  const rows = await ctx.db
    .select()
    .from(medications)
    .where(and(eq(medications.circleId, circleId), options.includeStopped ? undefined : eq(medications.status, "active")))
    .orderBy(asc(medications.status), asc(medications.name));
  return rows.map(serializeMedication);
}

export async function getMedication(ctx: ServiceContext, circleId: string, medicationId: string) {
  await authorize(ctx, circleId, "medication.view");
  return serializeMedication(await loadMedication(ctx.db, circleId, medicationId));
}

export async function createMedication(ctx: ServiceContext, circleId: string, input: z.infer<typeof createMedicationSchema>) {
  const access = await authorize(ctx, circleId, "medication.manage", { write: true });
  const startDate = input.startDate ?? localDateIn(access.profile.timeZone, ctx.now);
  if (input.endDate && input.endDate < startDate) {
    throw new AppError("validation_failed", "Some fields are invalid.", { endDate: ["The end date must be on or after the start date."] });
  }
  const row = await ctx.db.transaction(async (tx) => {
    const [created] = await tx
      .insert(medications)
      .values({
        circleId,
        name: input.name,
        dosage: input.dosage,
        instructions: input.instructions ?? null,
        prescriber: input.prescriber ?? null,
        startDate,
        endDate: input.endDate ?? null,
        asNeeded: input.asNeeded,
        scheduleTimes: input.asNeeded ? [] : [...new Set(input.times)].sort(),
        scheduleDays: input.daysOfWeek ? [...new Set(input.daysOfWeek)].sort() : null,
        unitsPerDose: input.unitsPerDose,
        supplyCount: input.supplyCount ?? null,
        refillThreshold: input.refillThreshold ?? null,
        createdBy: ctx.userId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .returning();
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: "medication.created",
      entityType: "medication",
      entityId: created.id,
      metadata: { name: created.name, dosage: created.dosage, times: created.scheduleTimes, asNeeded: created.asNeeded },
      now: ctx.now,
    });
    return created;
  });
  return serializeMedication(row);
}

const SCHEDULE_FIELDS = ["times", "daysOfWeek", "startDate", "endDate", "asNeeded"] as const;

export async function updateMedication(
  ctx: ServiceContext,
  circleId: string,
  medicationId: string,
  input: z.infer<typeof updateMedicationSchema>,
) {
  await authorize(ctx, circleId, "medication.manage", { write: true });
  const row = await ctx.db.transaction(async (tx) => {
    const current = await loadMedication(tx, circleId, medicationId);
    if (current.status === "stopped") throw new AppError("conflict", "This medicine has been stopped. Add it again to restart it.");

    const asNeeded = input.asNeeded ?? current.asNeeded;
    const times = asNeeded ? [] : [...new Set(input.times ?? current.scheduleTimes)].sort();
    const startDate = input.startDate ?? current.startDate;
    const endDate = input.endDate === undefined ? current.endDate : input.endDate;
    if (!asNeeded && times.length === 0) {
      throw new AppError("validation_failed", "Some fields are invalid.", { times: ["Add at least one time, or mark it as needed only."] });
    }
    if (endDate && endDate < startDate) {
      throw new AppError("validation_failed", "Some fields are invalid.", { endDate: ["The end date must be on or after the start date."] });
    }

    const changes = {
      name: input.name ?? current.name,
      dosage: input.dosage ?? current.dosage,
      instructions: input.instructions === undefined ? current.instructions : input.instructions,
      prescriber: input.prescriber === undefined ? current.prescriber : input.prescriber,
      startDate,
      endDate,
      asNeeded,
      scheduleTimes: times,
      scheduleDays: input.daysOfWeek === undefined ? current.scheduleDays : input.daysOfWeek && [...new Set(input.daysOfWeek)].sort(),
      unitsPerDose: input.unitsPerDose ?? current.unitsPerDose,
      supplyCount: input.supplyCount === undefined ? current.supplyCount : input.supplyCount,
      refillThreshold: input.refillThreshold === undefined ? current.refillThreshold : input.refillThreshold,
    };
    const [updated] = await tx
      .update(medications)
      .set({ ...changes, version: input.version + 1, updatedAt: ctx.now })
      .where(and(eq(medications.id, medicationId), eq(medications.version, input.version)))
      .returning();
    if (!updated) throw new AppError("conflict", "Someone else changed this medicine. Reload to see their changes, then try again.");

    const scheduleChanged = SCHEDULE_FIELDS.some((f) => input[f] !== undefined);
    if (scheduleChanged) await clearFutureUnansweredDoses(tx, { circleId, medicationId, after: ctx.now });

    const changed = Object.keys(input).filter((k) => k !== "version");
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: "medication.updated",
      entityType: "medication",
      entityId: medicationId,
      metadata: {
        name: updated.name,
        fields: changed,
        before: Object.fromEntries(changed.map((k) => [k, k === "times" ? current.scheduleTimes : k === "daysOfWeek" ? current.scheduleDays : current[k as keyof MedicationRow]])),
      },
      now: ctx.now,
    });
    return updated;
  });
  return serializeMedication(row);
}

/** Stops a medicine (kept for history) and removes its future unanswered doses. */
export async function stopMedication(
  ctx: ServiceContext,
  circleId: string,
  medicationId: string,
  input: z.infer<typeof stopMedicationSchema>,
) {
  const access: CircleAccess = await authorize(ctx, circleId, "medication.manage", { write: true });
  const today = localDateIn(access.profile.timeZone, ctx.now);
  const row = await ctx.db.transaction(async (tx) => {
    const current = await loadMedication(tx, circleId, medicationId);
    if (current.status === "stopped") return current;
    const endDate = current.endDate && current.endDate < today ? current.endDate : today;
    const [updated] = await tx
      .update(medications)
      .set({
        status: "stopped",
        stoppedAt: ctx.now,
        stoppedBy: ctx.userId,
        stopReason: input.reason ?? null,
        endDate: endDate < current.startDate ? current.startDate : endDate,
        version: current.version + 1,
        updatedAt: ctx.now,
      })
      .where(eq(medications.id, medicationId))
      .returning();
    await clearFutureUnansweredDoses(tx, { circleId, medicationId, after: ctx.now });
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: "medication.stopped",
      entityType: "medication",
      entityId: medicationId,
      metadata: { name: current.name, reason: input.reason ?? null },
      now: ctx.now,
    });
    return updated;
  });
  return serializeMedication(row);
}

/** Records a new stock count (e.g. after collecting a refill). Anyone who records doses may do this. */
export async function restockMedication(
  ctx: ServiceContext,
  circleId: string,
  medicationId: string,
  input: z.infer<typeof restockSchema>,
) {
  await authorize(ctx, circleId, "dose.record", { write: true });
  const row = await ctx.db.transaction(async (tx) => {
    const current = await loadMedication(tx, circleId, medicationId);
    const [updated] = await tx
      .update(medications)
      .set({ supplyCount: input.supplyCount, updatedAt: ctx.now })
      .where(eq(medications.id, medicationId))
      .returning();
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: "medication.restocked",
      entityType: "medication",
      entityId: medicationId,
      metadata: { name: current.name, from: current.supplyCount, to: input.supplyCount },
      now: ctx.now,
    });
    return updated;
  });
  return serializeMedication(row);
}

export { loadMedication };
