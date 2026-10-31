import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { appointments, memberships, users } from "@/server/db/schema";
import { AppError } from "@/server/http";
import { uuidSchema } from "@/server/validation";
import { authorize, loadCircleAccess, requireWritable, type CircleAccess, type DbOrTx, type ServiceContext } from "./access";
import { recordAudit } from "./audit";
import { HELPER_ROLES, resolveActiveMember } from "./members";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const instant = z.iso.datetime({ offset: true, message: "Enter a valid date and time." });

const appointmentFields = {
  title: z.string().trim().min(1, "Enter what the appointment is for.").max(120),
  kind: z.enum(["in_person", "virtual", "home_visit"]),
  clinician: optionalText(200),
  location: optionalText(500),
  virtualUrl: z
    .url({ protocol: /^https$/, message: "Enter a link starting with https://" })
    .max(1000)
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  startsAt: instant,
  endsAt: instant.nullable().optional(),
  reason: optionalText(1000),
  questions: optionalText(4000),
  transportNeeded: z.boolean(),
  transportNote: optionalText(500),
};

function checkTimes(v: { startsAt?: string; endsAt?: string | null }, ctx: z.RefinementCtx) {
  if (v.startsAt && v.endsAt && new Date(v.endsAt) <= new Date(v.startsAt)) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The end must be after the start." });
  }
}

export const createAppointmentSchema = z
  .object({ ...appointmentFields, kind: appointmentFields.kind.default("in_person"), transportNeeded: appointmentFields.transportNeeded.default(true) })
  .superRefine(checkTimes);

export const updateAppointmentSchema = z
  .object({ ...appointmentFields, version: z.int().positive() })
  .partial()
  .required({ version: true })
  .superRefine(checkTimes);

export const cancelAppointmentSchema = z.object({ reason: optionalText(500) });

export const assignHelperSchema = z.object({
  role: z.enum(["transport", "companion"]),
  /** Membership id, or null to clear. */
  memberId: z.string().nullable(),
});

export const completeAppointmentSchema = z.object({
  outcomeNote: optionalText(4000),
  followUp: optionalText(2000),
});

const transportMember = alias(memberships, "transport_member");
const transportUser = alias(users, "transport_user");
const companionMember = alias(memberships, "companion_member");
const companionUser = alias(users, "companion_user");
const outcomeUser = alias(users, "outcome_user");

function selectAppointments(db: DbOrTx) {
  return db
    .select({
      appointment: appointments,
      transportName: transportUser.name,
      companionName: companionUser.name,
      outcomeByName: outcomeUser.name,
    })
    .from(appointments)
    .leftJoin(transportMember, eq(transportMember.id, appointments.transportMemberId))
    .leftJoin(transportUser, eq(transportUser.id, transportMember.userId))
    .leftJoin(companionMember, eq(companionMember.id, appointments.companionMemberId))
    .leftJoin(companionUser, eq(companionUser.id, companionMember.userId))
    .leftJoin(outcomeUser, eq(outcomeUser.id, appointments.outcomeBy));
}

type Row = Awaited<ReturnType<ReturnType<typeof selectAppointments>["limit"]>>[number];

function serialize(r: Row) {
  const a = r.appointment;
  return {
    id: a.id,
    title: a.title,
    kind: a.kind,
    clinician: a.clinician,
    location: a.location,
    virtualUrl: a.virtualUrl,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    reason: a.reason,
    questions: a.questions,
    status: a.status,
    transportNeeded: a.transportNeeded,
    transport: a.transportMemberId ? { memberId: a.transportMemberId, name: r.transportName } : null,
    transportNote: a.transportNote,
    companion: a.companionMemberId ? { memberId: a.companionMemberId, name: r.companionName } : null,
    outcome: a.outcomeAt ? { note: a.outcomeNote, followUp: a.followUp, by: r.outcomeByName, at: a.outcomeAt } : null,
    cancelReason: a.cancelReason,
    cancelledAt: a.cancelledAt,
    version: a.version,
  };
}

async function load(db: DbOrTx, circleId: string, appointmentId: string) {
  if (!uuidSchema.safeParse(appointmentId).success) throw new AppError("not_found", "Appointment not found.");
  const [row] = await selectAppointments(db)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.circleId, circleId)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Appointment not found.");
  return row;
}

export async function listAppointments(ctx: ServiceContext, circleId: string, options: { range: "upcoming" | "past"; limit?: number }) {
  await authorize(ctx, circleId, "appointment.view");
  // "Upcoming" keeps today's earlier appointments visible for a few hours so they can be completed.
  const pivot = new Date(ctx.now.getTime() - 6 * 3_600_000);
  const rows = await selectAppointments(ctx.db)
    .where(
      and(
        eq(appointments.circleId, circleId),
        options.range === "upcoming" ? gte(appointments.startsAt, pivot) : lt(appointments.startsAt, pivot),
      ),
    )
    .orderBy(options.range === "upcoming" ? asc(appointments.startsAt) : desc(appointments.startsAt))
    .limit(Math.min(options.limit ?? 50, 200));
  return rows.map(serialize);
}

export async function getAppointment(ctx: ServiceContext, circleId: string, appointmentId: string) {
  await authorize(ctx, circleId, "appointment.view");
  return serialize(await load(ctx.db, circleId, appointmentId));
}

export async function createAppointment(ctx: ServiceContext, circleId: string, input: z.infer<typeof createAppointmentSchema>) {
  await authorize(ctx, circleId, "appointment.manage", { write: true });
  const id = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(appointments)
      .values({
        circleId,
        title: input.title,
        kind: input.kind,
        clinician: input.clinician ?? null,
        location: input.location ?? null,
        virtualUrl: input.virtualUrl ?? null,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        reason: input.reason ?? null,
        questions: input.questions ?? null,
        transportNeeded: input.kind === "in_person" ? input.transportNeeded : false,
        transportNote: input.transportNote ?? null,
        createdBy: ctx.userId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .returning({ id: appointments.id });
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: "appointment.created",
      entityType: "appointment",
      entityId: row.id,
      metadata: { name: input.title, startsAt: input.startsAt },
      now: ctx.now,
    });
    return row.id;
  });
  return serialize(await load(ctx.db, circleId, id));
}

export async function updateAppointment(
  ctx: ServiceContext,
  circleId: string,
  appointmentId: string,
  input: z.infer<typeof updateAppointmentSchema>,
) {
  await authorize(ctx, circleId, "appointment.manage", { write: true });
  await ctx.db.transaction(async (tx) => {
    const current = (await load(tx, circleId, appointmentId)).appointment;
    if (current.status !== "scheduled") throw new AppError("conflict", "Only scheduled appointments can be changed.");
    const startsAt = input.startsAt ? new Date(input.startsAt) : current.startsAt;
    const endsAt = input.endsAt === undefined ? current.endsAt : input.endsAt ? new Date(input.endsAt) : null;
    if (endsAt && endsAt <= startsAt) {
      throw new AppError("validation_failed", "Some fields are invalid.", { endsAt: ["The end must be after the start."] });
    }
    const rescheduled = startsAt.getTime() !== current.startsAt.getTime();
    const kind = input.kind ?? current.kind;
    const { version, ...fields } = input;
    const [updated] = await tx
      .update(appointments)
      .set({
        ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
        startsAt,
        endsAt,
        transportNeeded: kind === "in_person" ? (input.transportNeeded ?? current.transportNeeded) : false,
        // A new time needs new reminders.
        ...(rescheduled ? { reminderSentAt: null, transportAlertedAt: null } : {}),
        version: version + 1,
        updatedAt: ctx.now,
      })
      .where(and(eq(appointments.id, appointmentId), eq(appointments.version, version)))
      .returning({ id: appointments.id });
    if (!updated) throw new AppError("conflict", "Someone else changed this appointment. Reload to see their changes, then try again.");
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: rescheduled ? "appointment.rescheduled" : "appointment.updated",
      entityType: "appointment",
      entityId: appointmentId,
      metadata: { name: current.title, from: current.startsAt, to: startsAt, fields: Object.keys(fields) },
      now: ctx.now,
    });
  });
  return getAppointment(ctx, circleId, appointmentId);
}

export async function cancelAppointment(ctx: ServiceContext, circleId: string, appointmentId: string, input: z.infer<typeof cancelAppointmentSchema>) {
  await authorize(ctx, circleId, "appointment.manage", { write: true });
  await ctx.db.transaction(async (tx) => {
    const current = (await load(tx, circleId, appointmentId)).appointment;
    if (current.status !== "scheduled") throw new AppError("conflict", "Only scheduled appointments can be cancelled.");
    await tx
      .update(appointments)
      .set({ status: "cancelled", cancelReason: input.reason ?? null, cancelledAt: ctx.now, cancelledBy: ctx.userId, version: current.version + 1, updatedAt: ctx.now })
      .where(eq(appointments.id, appointmentId));
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: "appointment.cancelled",
      entityType: "appointment",
      entityId: appointmentId,
      metadata: { name: current.title, reason: input.reason ?? null },
      now: ctx.now,
    });
  });
  return getAppointment(ctx, circleId, appointmentId);
}

/**
 * Sets who drives / accompanies. Anyone who helps (admin, family, caregiver) may volunteer
 * themselves or step back; assigning or removing someone else requires appointment.manage.
 */
export async function assignHelper(ctx: ServiceContext, circleId: string, appointmentId: string, input: z.infer<typeof assignHelperSchema>) {
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  if (!access.can("appointment.view")) throw new AppError("forbidden", "You don't have permission to do this in this care circle.");
  requireWritable(access);
  const canManage = access.can("appointment.manage");
  const column = input.role === "transport" ? "transportMemberId" : "companionMemberId";

  await ctx.db.transaction(async (tx) => {
    const current = (await load(tx, circleId, appointmentId)).appointment;
    if (current.status !== "scheduled") throw new AppError("conflict", "This appointment is no longer scheduled.");
    const existing = current[column];
    if (input.memberId === null) {
      if (existing && existing !== access.membership.id && !canManage) {
        throw new AppError("forbidden", "Only the person themselves or an organiser can remove them.");
      }
    } else {
      const self = input.memberId === access.membership.id;
      if (!self && !canManage) throw new AppError("forbidden", "You can volunteer yourself; organisers can assign others.");
      if (self && !HELPER_ROLES.includes(access.membership.role)) {
        throw new AppError("forbidden", "Your role in this circle doesn't take on driving or accompanying.");
      }
      await resolveActiveMember(tx, circleId, input.memberId, ctx.now, HELPER_ROLES);
    }
    await tx
      .update(appointments)
      .set({ [column]: input.memberId, version: current.version + 1, updatedAt: ctx.now })
      .where(eq(appointments.id, appointmentId));
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: input.role === "transport" ? "appointment.transport_changed" : "appointment.companion_changed",
      entityType: "appointment",
      entityId: appointmentId,
      metadata: { name: current.title, memberId: input.memberId },
      now: ctx.now,
    });
  });
  return getAppointment(ctx, circleId, appointmentId);
}

/** Who may record the outcome: organisers and the person who went along. */
export function canRecordOutcome(access: CircleAccess, appointment: { companionMemberId: string | null; transportMemberId: string | null }) {
  return (
    access.can("appointment.manage") ||
    appointment.companionMemberId === access.membership.id ||
    appointment.transportMemberId === access.membership.id
  );
}

export async function completeAppointment(
  ctx: ServiceContext,
  circleId: string,
  appointmentId: string,
  input: z.infer<typeof completeAppointmentSchema>,
) {
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  requireWritable(access);
  await ctx.db.transaction(async (tx) => {
    const current = (await load(tx, circleId, appointmentId)).appointment;
    if (!access.can("appointment.view") || !canRecordOutcome(access, current)) {
      throw new AppError("forbidden", "Only organisers or the person who went along can record what happened.");
    }
    if (current.status === "cancelled") throw new AppError("conflict", "This appointment was cancelled.");
    if (current.startsAt.getTime() > ctx.now.getTime()) throw new AppError("conflict", "This appointment hasn't happened yet.");
    await tx
      .update(appointments)
      .set({
        status: "completed",
        outcomeNote: input.outcomeNote ?? null,
        followUp: input.followUp ?? null,
        outcomeBy: ctx.userId,
        outcomeAt: ctx.now,
        version: current.version + 1,
        updatedAt: ctx.now,
      })
      .where(eq(appointments.id, appointmentId));
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: current.status === "completed" ? "appointment.outcome_corrected" : "appointment.completed",
      entityType: "appointment",
      entityId: appointmentId,
      metadata: { name: current.title },
      now: ctx.now,
    });
  });
  return getAppointment(ctx, circleId, appointmentId);
}
