import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { emergencyContacts, emergencyInfoCards, memberships, users, type EmergencyInfo } from "@/server/db/schema";
import { AppError } from "@/server/http";
import { uuidSchema } from "@/server/validation";
import { authorize, loadCircleAccess, requireWritable, type CircleAccess, type ServiceContext } from "./access";
import { recordAudit } from "./audit";
import { resolveActiveMember } from "./members";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const INFO_FIELDS = [
  "conditions",
  "allergies",
  "medicationsNote",
  "bloodGroup",
  "doctorName",
  "doctorPhone",
  "preferredHospital",
  "insuranceNote",
  "advanceDirectiveNote",
  "communicationNote",
  "mobilityNote",
  "homeAccessNote",
] as const;

export const emergencyInfoSchema = z.object(
  Object.fromEntries(INFO_FIELDS.map((f) => [f, optionalText(f === "bloodGroup" ? 10 : 1000)])) as Record<(typeof INFO_FIELDS)[number], ReturnType<typeof optionalText>>,
);

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{3,20}$/, "Enter a phone number.");

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(100),
  phone,
  relationship: optionalText(100),
  notes: optionalText(500),
  /** Forms send "1"; the API also accepts numbers. */
  tier: z.coerce.number().int().min(1).max(3).default(1),
  memberId: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v)),
});

export const updateContactSchema = contactSchema.partial();

/**
 * Who may edit emergency information and contacts: circle managers (admins, a self-managing
 * recipient). It is deliberately readable by everyone in the circle, including emergency contacts.
 */
function requireEmergencyEditor(access: CircleAccess) {
  if (!access.can("circle.manage")) throw new AppError("forbidden", "Only the people who manage this circle can change emergency details.");
  requireWritable(access);
}

export async function getEmergencyInfo(ctx: ServiceContext, circleId: string) {
  const access = await authorize(ctx, circleId, "emergency.view");
  const [card] = await ctx.db
    .select({ info: emergencyInfoCards.info, updatedAt: emergencyInfoCards.updatedAt, updatedBy: users.name })
    .from(emergencyInfoCards)
    .leftJoin(users, eq(users.id, emergencyInfoCards.updatedBy))
    .where(eq(emergencyInfoCards.circleId, circleId));
  return {
    recipient: {
      name: access.profile.displayName,
      preferredName: access.profile.preferredName,
      dateOfBirth: access.can("health.view") ? access.profile.dateOfBirth : null,
    },
    emergencyNumber: access.profile.emergencyNumber,
    info: (card?.info ?? {}) as EmergencyInfo,
    updatedAt: card?.updatedAt ?? null,
    updatedBy: card?.updatedBy ?? null,
  };
}

export async function updateEmergencyInfo(ctx: ServiceContext, circleId: string, input: z.infer<typeof emergencyInfoSchema>) {
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  requireEmergencyEditor(access);
  const info = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as EmergencyInfo;
  await ctx.db.transaction(async (tx) => {
    await tx
      .insert(emergencyInfoCards)
      .values({ circleId, info, updatedBy: ctx.userId, updatedAt: ctx.now })
      .onConflictDoUpdate({ target: emergencyInfoCards.circleId, set: { info, updatedBy: ctx.userId, updatedAt: ctx.now } });
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: "emergency.info_updated",
      entityType: "emergency_info",
      entityId: null,
      metadata: { fields: Object.keys(info) },
      now: ctx.now,
    });
  });
  return getEmergencyInfo(ctx, circleId);
}

export async function listEmergencyContacts(ctx: ServiceContext, circleId: string) {
  await authorize(ctx, circleId, "emergency.view");
  return ctx.db
    .select({
      id: emergencyContacts.id,
      name: emergencyContacts.name,
      phone: emergencyContacts.phone,
      relationship: emergencyContacts.relationship,
      notes: emergencyContacts.notes,
      tier: emergencyContacts.tier,
      memberId: emergencyContacts.memberId,
      memberActive: memberships.status,
    })
    .from(emergencyContacts)
    .leftJoin(memberships, eq(memberships.id, emergencyContacts.memberId))
    .where(eq(emergencyContacts.circleId, circleId))
    .orderBy(asc(emergencyContacts.tier), asc(emergencyContacts.createdAt))
    .then((rows) =>
      rows.map(({ memberActive, ...c }) => ({
        ...c,
        // Linked members get alerts in their tier's turn; everyone else can only be called.
        receivesAlerts: c.memberId !== null && memberActive === "active",
      })),
    );
}

export async function createEmergencyContact(ctx: ServiceContext, circleId: string, raw: z.input<typeof contactSchema>) {
  const input = contactSchema.parse(raw);
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  requireEmergencyEditor(access);
  await ctx.db.transaction(async (tx) => {
    if (input.memberId) await resolveActiveMember(tx, circleId, input.memberId, ctx.now);
    const [row] = await tx
      .insert(emergencyContacts)
      .values({
        circleId,
        name: input.name,
        phone: input.phone,
        relationship: input.relationship ?? null,
        notes: input.notes ?? null,
        tier: input.tier,
        memberId: input.memberId ?? null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .returning({ id: emergencyContacts.id });
    await recordAudit(tx, { circleId, actorUserId: ctx.userId, action: "emergency.contact_added", entityType: "emergency_contact", entityId: row.id, metadata: { name: input.name }, now: ctx.now });
  });
  return listEmergencyContacts(ctx, circleId);
}

async function loadContact(ctx: ServiceContext, circleId: string, contactId: string) {
  if (!uuidSchema.safeParse(contactId).success) throw new AppError("not_found", "Contact not found.");
  const [c] = await ctx.db.select().from(emergencyContacts).where(and(eq(emergencyContacts.id, contactId), eq(emergencyContacts.circleId, circleId)));
  if (!c) throw new AppError("not_found", "Contact not found.");
  return c;
}

export async function updateEmergencyContact(ctx: ServiceContext, circleId: string, contactId: string, input: z.infer<typeof updateContactSchema>) {
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  requireEmergencyEditor(access);
  const current = await loadContact(ctx, circleId, contactId);
  if (input.memberId) await resolveActiveMember(ctx.db, circleId, input.memberId, ctx.now);
  const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  await ctx.db.transaction(async (tx) => {
    await tx.update(emergencyContacts).set({ ...set, updatedAt: ctx.now }).where(eq(emergencyContacts.id, contactId));
    await recordAudit(tx, { circleId, actorUserId: ctx.userId, action: "emergency.contact_updated", entityType: "emergency_contact", entityId: contactId, metadata: { name: input.name ?? current.name }, now: ctx.now });
  });
  return listEmergencyContacts(ctx, circleId);
}

export async function deleteEmergencyContact(ctx: ServiceContext, circleId: string, contactId: string) {
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  requireEmergencyEditor(access);
  const current = await loadContact(ctx, circleId, contactId);
  await ctx.db.transaction(async (tx) => {
    await tx.delete(emergencyContacts).where(eq(emergencyContacts.id, contactId));
    await recordAudit(tx, { circleId, actorUserId: ctx.userId, action: "emergency.contact_removed", entityType: "emergency_contact", entityId: contactId, metadata: { name: current.name }, now: ctx.now });
  });
}
