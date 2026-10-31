import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { CIRCLE_ROLES } from "@/server/auth/permissions";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { generateToken, hashToken } from "@/server/auth/tokens";
import { careCircles, careProfiles, invitations, memberships, users } from "@/server/db/schema";
import { AppError } from "@/server/http";
import { emailSchema, uuidSchema } from "@/server/validation";
import { authorize, type ServiceContext } from "./access";
import type { Db } from "@/server/db";
import { recordAudit } from "./audit";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITATIONS_PER_USER_PER_DAY = 30;

export const createInvitationSchema = z.object({
  email: emailSchema,
  role: z.enum(CIRCLE_ROLES),
  /** For temporary access (e.g. a relief caregiver): when the membership should end. */
  accessExpiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

function statusOf(inv: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date): InvitationStatus {
  if (inv.acceptedAt) return "accepted";
  if (inv.revokedAt) return "revoked";
  if (inv.expiresAt.getTime() <= now.getTime()) return "expired";
  return "pending";
}

export async function createInvitation(
  ctx: ServiceContext,
  circleId: string,
  input: z.infer<typeof createInvitationSchema>,
  appOrigin: string,
) {
  const access = await authorize(ctx, circleId, "members.manage", { write: true });

  const accessExpiresAt = input.accessExpiresAt ? new Date(input.accessExpiresAt) : null;
  if (accessExpiresAt && accessExpiresAt.getTime() <= ctx.now.getTime()) {
    throw new AppError("validation_failed", "Some fields are invalid.", { accessExpiresAt: ["Choose a time in the future."] });
  }
  if (input.role === "care_recipient" && access.profile.linkedUserId) {
    throw new AppError("conflict", `${access.profile.displayName} already has their own account in this circle.`);
  }

  const limit = await consumeRateLimit(ctx.db, {
    key: `invite:user:${ctx.userId}`,
    limit: INVITATIONS_PER_USER_PER_DAY,
    windowMs: 24 * 60 * 60 * 1000,
    now: ctx.now,
  });
  if (!limit.allowed) throw new AppError("rate_limited", "You've sent a lot of invitations today. Please try again tomorrow.");

  const [existing] = await ctx.db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.circleId, circleId), eq(memberships.status, "active"), eq(users.email, input.email)))
    .limit(1);
  if (existing) throw new AppError("conflict", "This person is already a member of the circle.");

  const token = generateToken();
  const invitation = await ctx.db.transaction(async (tx) => {
    // A new invitation to the same address replaces any earlier pending one.
    await tx
      .update(invitations)
      .set({ revokedAt: ctx.now })
      .where(
        and(
          eq(invitations.circleId, circleId),
          eq(invitations.email, input.email),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      );
    const [row] = await tx
      .insert(invitations)
      .values({
        circleId,
        email: input.email,
        role: input.role,
        tokenHash: hashToken(token),
        invitedBy: ctx.userId,
        accessExpiresAt,
        expiresAt: new Date(ctx.now.getTime() + INVITATION_TTL_MS),
        createdAt: ctx.now,
      })
      .returning();
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: "invitation.created",
      entityType: "invitation",
      entityId: row.id,
      metadata: { email: input.email, role: input.role, accessExpiresAt },
      now: ctx.now,
    });
    return row;
  });

  return {
    invitation: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      accessExpiresAt: invitation.accessExpiresAt,
      expiresAt: invitation.expiresAt,
      status: "pending" as const,
    },
    // Returned once; only its hash is stored. Email delivery arrives with the notification channels (M4).
    inviteUrl: `${appOrigin}/invite/${token}`,
  };
}

export async function listPendingInvitations(ctx: ServiceContext, circleId: string) {
  await authorize(ctx, circleId, "members.manage");
  return ctx.db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      accessExpiresAt: invitations.accessExpiresAt,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
      invitedBy: { id: users.id, name: users.name },
    })
    .from(invitations)
    .leftJoin(users, eq(users.id, invitations.invitedBy))
    .where(
      and(
        eq(invitations.circleId, circleId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, ctx.now),
      ),
    )
    .orderBy(asc(invitations.createdAt));
}

export async function revokeInvitation(ctx: ServiceContext, circleId: string, invitationId: string) {
  await authorize(ctx, circleId, "members.manage", { write: true });
  if (!uuidSchema.safeParse(invitationId).success) throw new AppError("not_found", "Invitation not found.");
  await ctx.db.transaction(async (tx) => {
    const revoked = await tx
      .update(invitations)
      .set({ revokedAt: ctx.now })
      .where(
        and(
          eq(invitations.id, invitationId),
          eq(invitations.circleId, circleId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .returning({ id: invitations.id, email: invitations.email });
    if (revoked.length === 0) throw new AppError("not_found", "Invitation not found.");
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: "invitation.revoked",
      entityType: "invitation",
      entityId: invitationId,
      metadata: { email: revoked[0].email },
      now: ctx.now,
    });
  });
}

async function findByToken(db: Db, token: string) {
  if (!token || token.length > 100) return undefined;
  const [row] = await db
    .select({
      invitation: invitations,
      circleName: careCircles.name,
      circleStatus: careCircles.status,
      recipientName: careProfiles.displayName,
      inviterName: users.name,
    })
    .from(invitations)
    .innerJoin(careCircles, eq(careCircles.id, invitations.circleId))
    .innerJoin(careProfiles, eq(careProfiles.circleId, invitations.circleId))
    .leftJoin(users, eq(users.id, invitations.invitedBy))
    .where(eq(invitations.tokenHash, hashToken(token)))
    .limit(1);
  return row;
}

/** What the invite page shows before accepting. Only the token holder can see this. */
export async function previewInvitation(db: Db, token: string, now: Date) {
  const row = await findByToken(db, token);
  if (!row) throw new AppError("not_found", "This invitation link is not valid.");
  return {
    circleName: row.circleName,
    recipientName: row.recipientName,
    inviterName: row.inviterName,
    email: row.invitation.email,
    role: row.invitation.role,
    accessExpiresAt: row.invitation.accessExpiresAt,
    expiresAt: row.invitation.expiresAt,
    status: statusOf(row.invitation, now),
  };
}

/**
 * Accepts an invitation for the signed-in user, who must be signed in with the invited email.
 * Idempotent for someone who is already a member; reactivates a previously removed member.
 */
export async function acceptInvitation(ctx: ServiceContext & { userEmail: string }, token: string) {
  const row = await findByToken(ctx.db, token);
  if (!row) throw new AppError("not_found", "This invitation link is not valid.");
  const inv = row.invitation;

  const status = statusOf(inv, ctx.now);
  if (status === "revoked") throw new AppError("conflict", "This invitation was cancelled. Ask for a new one.");
  if (status === "expired") throw new AppError("conflict", "This invitation has expired. Ask for a new one.");
  if (status === "accepted") {
    if (inv.acceptedBy === ctx.userId) return { circleId: inv.circleId };
    throw new AppError("conflict", "This invitation has already been used.");
  }
  if (inv.email !== ctx.userEmail) {
    throw new AppError("forbidden", `This invitation was sent to ${inv.email}. Sign in with that email address to accept it.`);
  }
  if (row.circleStatus === "archived") throw new AppError("conflict", "This care circle is archived.");

  await ctx.db.transaction(async (tx) => {
    // Re-check under lock so two simultaneous accepts cannot both succeed.
    const [locked] = await tx.select().from(invitations).where(eq(invitations.id, inv.id)).for("update");
    if (locked.acceptedAt || locked.revokedAt) throw new AppError("conflict", "This invitation has already been used.");

    if (inv.role === "care_recipient") {
      const [profile] = await tx
        .select({ linkedUserId: careProfiles.linkedUserId })
        .from(careProfiles)
        .where(eq(careProfiles.circleId, inv.circleId))
        .for("update");
      if (profile.linkedUserId && profile.linkedUserId !== ctx.userId) {
        throw new AppError("conflict", "Someone else is already linked as the care recipient.");
      }
      await tx.update(careProfiles).set({ linkedUserId: ctx.userId }).where(eq(careProfiles.circleId, inv.circleId));
    }

    const [current] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.circleId, inv.circleId), eq(memberships.userId, ctx.userId)))
      .limit(1);
    let membershipId: string;
    if (current?.status === "active") {
      membershipId = current.id; // Already a member: accepting just consumes the invitation.
    } else if (current) {
      await tx
        .update(memberships)
        .set({
          role: inv.role,
          status: "active",
          isLegalRepresentative: false,
          expiresAt: inv.accessExpiresAt,
          revokedAt: null,
          revokedBy: null,
          createdAt: ctx.now,
        })
        .where(eq(memberships.id, current.id));
      membershipId = current.id;
    } else {
      const [created] = await tx
        .insert(memberships)
        .values({ circleId: inv.circleId, userId: ctx.userId, role: inv.role, expiresAt: inv.accessExpiresAt, createdAt: ctx.now })
        .returning({ id: memberships.id });
      membershipId = created.id;
    }

    await tx.update(invitations).set({ acceptedAt: ctx.now, acceptedBy: ctx.userId }).where(eq(invitations.id, inv.id));
    await recordAudit(tx, {
      circleId: inv.circleId,
      actorUserId: ctx.userId,
      action: "invitation.accepted",
      entityType: "membership",
      entityId: membershipId,
      metadata: { invitationId: inv.id, role: inv.role },
      now: ctx.now,
    });
  });

  return { circleId: inv.circleId };
}
