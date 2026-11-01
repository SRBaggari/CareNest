import { and, asc, eq, isNull, or, gt } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_CONSENT, hasManager, type CircleRole } from "@/server/auth/permissions";
import { careCircles, careProfiles, memberships } from "@/server/db/schema";
import { AppError } from "@/server/http";
import { localeSchema, nameSchema, timeZoneSchema } from "@/server/validation";
import { authorize, loadCircleAccess, type CircleAccess, type ServiceContext } from "./access";
import { recordAudit } from "./audit";
import { clearFutureUnansweredDoses } from "./medications";

/** Local emergency numbers for the countries we expect first; 112 works across the EU and in India. */
const EMERGENCY_NUMBERS: Record<string, string> = { IN: "112", US: "911", CA: "911", GB: "999", AU: "000", NZ: "111" };

export function defaultEmergencyNumber(country: string): string {
  return EMERGENCY_NUMBERS[country.toUpperCase()] ?? "112";
}

const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Choose a country.");

const emergencyNumberSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{2,15}$/, "Enter a phone number using digits only.");

/** Date of birth as YYYY-MM-DD, not in the future, not before 1900. */
const dateOfBirthSchema = z.iso
  .date({ message: "Enter a valid date." })
  .refine((d) => d >= "1900-01-01" && d <= new Date().toISOString().slice(0, 10), {
    message: "Enter a valid date of birth.",
  });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const createCircleSchema = z.object({
  name: nameSchema,
  /** Who is creating it: a family member (becomes admin) or the recipient themselves. */
  creatorRole: z.enum(["admin", "care_recipient"]).default("admin"),
  recipient: z.object({
    displayName: nameSchema,
    preferredName: optionalText(100),
    dateOfBirth: dateOfBirthSchema.nullable().optional(),
    timeZone: timeZoneSchema,
    country: countrySchema,
    locale: localeSchema.default("en"),
    selfManaging: z.boolean().default(true),
    emergencyNumber: emergencyNumberSchema.optional(),
  }),
});

export const updateCircleSchema = z.object({
  /** The profile version the client edited; a stale version is rejected with 409. */
  version: z.int().positive(),
  name: nameSchema.optional(),
  displayName: nameSchema.optional(),
  preferredName: optionalText(100),
  dateOfBirth: dateOfBirthSchema.nullable().optional(),
  timeZone: timeZoneSchema.optional(),
  country: countrySchema.optional(),
  locale: localeSchema.optional(),
  emergencyNumber: emergencyNumberSchema.optional(),
});

export const consentSchema = z.object({
  shareMedications: z.boolean(),
  shareAppointments: z.boolean(),
  shareHealth: z.boolean(),
  allowAssistant: z.boolean().default(false),
});

export const selfManagingSchema = z.object({ selfManaging: z.boolean(), version: z.int().positive() });

export function serializeCircle(access: CircleAccess) {
  return {
    id: access.circle.id,
    name: access.circle.name,
    status: access.circle.status,
    profile: {
      displayName: access.profile.displayName,
      preferredName: access.profile.preferredName,
      dateOfBirth: access.can("health.view") ? access.profile.dateOfBirth : null,
      timeZone: access.profile.timeZone,
      country: access.profile.country,
      locale: access.profile.locale,
      selfManaging: access.profile.selfManaging,
      hasOwnAccount: access.profile.linkedUserId !== null,
      emergencyNumber: access.profile.emergencyNumber,
      consent: access.profile.consent,
      version: access.profile.version,
    },
    myMembership: access.membership,
    myCapabilities: access.capabilities,
  };
}

export async function createCircle(ctx: ServiceContext, input: z.infer<typeof createCircleSchema>) {
  const circleId = await ctx.db.transaction(async (tx) => {
    const [circle] = await tx
      .insert(careCircles)
      .values({ name: input.name, createdBy: ctx.userId, createdAt: ctx.now, updatedAt: ctx.now })
      .returning({ id: careCircles.id });
    const r = input.recipient;
    await tx.insert(careProfiles).values({
      circleId: circle.id,
      displayName: r.displayName,
      preferredName: r.preferredName ?? null,
      dateOfBirth: r.dateOfBirth ?? null,
      timeZone: r.timeZone,
      country: r.country,
      locale: r.locale,
      // Someone creating their own circle is by definition managing their own care.
      selfManaging: input.creatorRole === "care_recipient" ? true : r.selfManaging,
      linkedUserId: input.creatorRole === "care_recipient" ? ctx.userId : null,
      emergencyNumber: r.emergencyNumber ?? defaultEmergencyNumber(r.country),
      consent: DEFAULT_CONSENT,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    const [membership] = await tx
      .insert(memberships)
      .values({ circleId: circle.id, userId: ctx.userId, role: input.creatorRole, createdAt: ctx.now })
      .returning({ id: memberships.id });
    await recordAudit(tx, {
      circleId: circle.id,
      actorUserId: ctx.userId,
      action: "circle.created",
      entityType: "care_circle",
      entityId: circle.id,
      metadata: { creatorRole: input.creatorRole, membershipId: membership.id },
      now: ctx.now,
    });
    return circle.id;
  });
  return serializeCircle(await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now));
}

/** Circles the user can currently access (active, unexpired membership), oldest first. */
export async function listMyCircles(ctx: ServiceContext) {
  return ctx.db
    .select({
      id: careCircles.id,
      name: careCircles.name,
      status: careCircles.status,
      recipientName: careProfiles.displayName,
      preferredName: careProfiles.preferredName,
      timeZone: careProfiles.timeZone,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(careCircles, eq(careCircles.id, memberships.circleId))
    .innerJoin(careProfiles, eq(careProfiles.circleId, careCircles.id))
    .where(
      and(
        eq(memberships.userId, ctx.userId),
        eq(memberships.status, "active"),
        or(isNull(memberships.expiresAt), gt(memberships.expiresAt, ctx.now)),
      ),
    )
    .orderBy(asc(careCircles.createdAt));
}

export async function getCircle(ctx: ServiceContext, circleId: string) {
  return serializeCircle(await authorize(ctx, circleId, "circle.view"));
}

/** Applies a profile update only if `version` still matches, so concurrent edits never silently overwrite. */
async function updateProfileVersioned(
  ctx: ServiceContext,
  access: CircleAccess,
  version: number,
  changes: Partial<typeof careProfiles.$inferInsert>,
  audit: { action: string; metadata: Record<string, unknown> },
  circleChanges?: Partial<typeof careCircles.$inferInsert>,
) {
  await ctx.db.transaction(async (tx) => {
    const updated = await tx
      .update(careProfiles)
      .set({ ...changes, version: version + 1, updatedAt: ctx.now })
      .where(and(eq(careProfiles.circleId, access.circle.id), eq(careProfiles.version, version)))
      .returning({ id: careProfiles.id });
    if (updated.length === 0) {
      throw new AppError("conflict", "Someone else changed this profile. Reload to see their changes, then try again.");
    }
    if (circleChanges) {
      await tx.update(careCircles).set({ ...circleChanges, updatedAt: ctx.now }).where(eq(careCircles.id, access.circle.id));
    }
    await recordAudit(tx, {
      circleId: access.circle.id,
      actorUserId: ctx.userId,
      action: audit.action,
      entityType: "care_profile",
      entityId: access.profile.id,
      metadata: audit.metadata,
      now: ctx.now,
    });
  });
}

export async function updateCircle(ctx: ServiceContext, circleId: string, input: z.infer<typeof updateCircleSchema>) {
  const access = await authorize(ctx, circleId, "circle.manage", { write: true });
  const { version, name, ...profileChanges } = input;
  const defined = Object.fromEntries(Object.entries(profileChanges).filter(([, v]) => v !== undefined));
  await updateProfileVersioned(
    ctx,
    access,
    version,
    defined,
    { action: "circle.updated", metadata: { fields: [...Object.keys(defined), ...(name !== undefined ? ["name"] : [])] } },
    name !== undefined ? { name } : undefined,
  );
  // Doses follow the recipient's wall clock: after a move, upcoming doses are regenerated in the new zone.
  if (input.timeZone && input.timeZone !== access.profile.timeZone) {
    await clearFutureUnansweredDoses(ctx.db, { circleId, after: ctx.now });
  }
  return getCircle(ctx, circleId);
}

export async function updateConsent(ctx: ServiceContext, circleId: string, consent: z.infer<typeof consentSchema>) {
  const access = await authorize(ctx, circleId, "consent.manage", { write: true });
  await updateProfileVersioned(ctx, access, access.profile.version, { consent }, {
    action: "consent.updated",
    metadata: { from: access.profile.consent, to: consent },
  });
  return getCircle(ctx, circleId);
}

/**
 * Changes whether the recipient manages their own care decisions. Turning it OFF takes decisions
 * away from the recipient, so it is never an admin override of someone on the platform: only the
 * recipient themselves, their legal representative, or — if the recipient has no account — an
 * admin may do it. Turning it back ON is for an admin or the legal representative. Always audited.
 */
export async function setSelfManaging(ctx: ServiceContext, circleId: string, input: z.infer<typeof selfManagingSchema>) {
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  const role: CircleRole = access.membership.role;
  const isRep = access.membership.isLegalRepresentative;
  const allowed = input.selfManaging
    ? role === "admin" || isRep
    : role === "care_recipient" || isRep || (role === "admin" && access.profile.linkedUserId === null);
  if (!allowed) throw new AppError("forbidden", "You don't have permission to do this in this care circle.");
  if (access.circle.status === "archived") throw new AppError("conflict", "This care circle is archived and can no longer be changed.");
  const members = await ctx.db
    .select({ role: memberships.role, expiresAt: memberships.expiresAt })
    .from(memberships)
    .where(and(eq(memberships.circleId, circleId), eq(memberships.status, "active")));
  const active = members.map((m) => ({ role: m.role, active: !m.expiresAt || m.expiresAt.getTime() > ctx.now.getTime() }));
  if (!hasManager(active, { selfManaging: input.selfManaging })) {
    throw new AppError("conflict", "Add an admin to the circle first, so someone can manage it.");
  }
  await updateProfileVersioned(ctx, access, input.version, { selfManaging: input.selfManaging }, {
    action: "profile.self_managing_changed",
    metadata: { from: access.profile.selfManaging, to: input.selfManaging },
  });
  return getCircle(ctx, circleId);
}

export async function archiveCircle(ctx: ServiceContext, circleId: string) {
  const access = await authorize(ctx, circleId, "circle.manage", { write: true });
  await ctx.db.transaction(async (tx) => {
    await tx.update(careCircles).set({ status: "archived", updatedAt: ctx.now }).where(eq(careCircles.id, access.circle.id));
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: "circle.archived",
      entityType: "care_circle",
      entityId: circleId,
      now: ctx.now,
    });
  });
  return getCircle(ctx, circleId);
}
