import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { CIRCLE_ROLES, hasManager, type CircleRole } from "@/server/auth/permissions";
import { careProfiles, memberships, users } from "@/server/db/schema";
import { AppError } from "@/server/http";
import { uuidSchema } from "@/server/validation";
import { authorize, loadCircleAccess, requireWritable, type DbTx, type ServiceContext } from "./access";
import { recordAudit } from "./audit";

export const updateMemberSchema = z
  .object({
    role: z.enum(CIRCLE_ROLES),
    isLegalRepresentative: z.boolean(),
    /** ISO timestamp for temporary access, or null to make access permanent. */
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

export async function listMembers(ctx: ServiceContext, circleId: string) {
  const access = await authorize(ctx, circleId, "members.view");
  const rows = await ctx.db
    .select({
      id: memberships.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
      isLegalRepresentative: memberships.isLegalRepresentative,
      expiresAt: memberships.expiresAt,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.circleId, circleId), eq(memberships.status, "active")))
    .orderBy(asc(memberships.createdAt));
  // Emails are contact details: only shown to people who manage membership.
  const showEmail = access.can("members.manage");
  return rows
    .filter((m) => !m.expiresAt || m.expiresAt.getTime() > ctx.now.getTime())
    .map((m) => ({ ...m, email: showEmail || m.userId === ctx.userId ? m.email : null }));
}

async function activeMembersForUpdate(tx: DbTx, circleId: string, now: Date) {
  const rows = await tx
    .select({ id: memberships.id, role: memberships.role, expiresAt: memberships.expiresAt })
    .from(memberships)
    .where(and(eq(memberships.circleId, circleId), eq(memberships.status, "active")))
    .for("update");
  return rows.map((r) => ({ ...r, active: !r.expiresAt || r.expiresAt.getTime() > now.getTime() }));
}

async function loadTarget(tx: DbTx, circleId: string, memberId: string) {
  if (!uuidSchema.safeParse(memberId).success) throw new AppError("not_found", "Member not found.");
  const [target] = await tx
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, memberId), eq(memberships.circleId, circleId), eq(memberships.status, "active")))
    .limit(1);
  if (!target) throw new AppError("not_found", "Member not found.");
  return target;
}

export async function updateMember(
  ctx: ServiceContext,
  circleId: string,
  memberId: string,
  input: z.infer<typeof updateMemberSchema>,
) {
  const access = await authorize(ctx, circleId, "members.manage", { write: true });
  await ctx.db.transaction(async (tx) => {
    const target = await loadTarget(tx, circleId, memberId);
    const members = await activeMembersForUpdate(tx, circleId, ctx.now);

    if (target.role === "care_recipient") {
      throw new AppError("forbidden", "The care recipient's own membership can't be changed by others.");
    }
    if (input.role === "care_recipient") {
      throw new AppError("conflict", "The care recipient's role can only be given by invitation.");
    }
    const expiresAt = input.expiresAt === undefined ? target.expiresAt : input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= ctx.now.getTime()) {
      throw new AppError("validation_failed", "Some fields are invalid.", { expiresAt: ["Choose a time in the future."] });
    }
    const nextRole: CircleRole = input.role ?? target.role;
    const after = members.map((m) => (m.id === target.id ? { ...m, role: nextRole, active: true } : m));
    if (!hasManager(after, access.profile)) {
      throw new AppError("conflict", "A care circle needs at least one person who can manage it. Add another admin first.");
    }

    await tx
      .update(memberships)
      .set({
        role: nextRole,
        isLegalRepresentative: input.isLegalRepresentative ?? target.isLegalRepresentative,
        expiresAt,
      })
      .where(eq(memberships.id, target.id));
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: "member.updated",
      entityType: "membership",
      entityId: target.id,
      metadata: {
        userId: target.userId,
        from: { role: target.role, isLegalRepresentative: target.isLegalRepresentative, expiresAt: target.expiresAt },
        to: { role: nextRole, isLegalRepresentative: input.isLegalRepresentative ?? target.isLegalRepresentative, expiresAt },
      },
      now: ctx.now,
    });
  });
  return listMembers(ctx, circleId);
}

/**
 * Removes a member immediately (their next request is denied). Members may always leave a
 * circle themselves; removing others needs members.manage. The last manager cannot be removed.
 */
export async function removeMember(ctx: ServiceContext, circleId: string, memberId: string) {
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  const leavingSelf = memberId === access.membership.id;
  if (!leavingSelf && !access.can("members.manage")) {
    throw new AppError("forbidden", "You don't have permission to do this in this care circle.");
  }
  requireWritable(access);

  await ctx.db.transaction(async (tx) => {
    const target = await loadTarget(tx, circleId, memberId);
    if (target.role === "care_recipient" && !leavingSelf) {
      throw new AppError("forbidden", "Only the care recipient can remove themselves from their own circle.");
    }
    const members = await activeMembersForUpdate(tx, circleId, ctx.now);
    const after = members.filter((m) => m.id !== target.id);
    if (!hasManager(after, access.profile)) {
      throw new AppError("conflict", "A care circle needs at least one person who can manage it. Add another admin first.");
    }
    await tx
      .update(memberships)
      .set({ status: "revoked", revokedAt: ctx.now, revokedBy: ctx.userId })
      .where(eq(memberships.id, target.id));
    if (target.role === "care_recipient") {
      await tx.update(careProfiles).set({ linkedUserId: null }).where(eq(careProfiles.circleId, circleId));
    }
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: leavingSelf ? "member.left" : "member.removed",
      entityType: "membership",
      entityId: target.id,
      metadata: { userId: target.userId, role: target.role },
      now: ctx.now,
    });
  });
}
