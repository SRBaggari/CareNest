import { and, eq } from "drizzle-orm";
import type { Db } from "@/server/db";
import { careCircles, careProfiles, memberships } from "@/server/db/schema";
import { can, capabilitiesFor, type Capability, type CircleRole } from "@/server/auth/permissions";
import { AppError } from "@/server/http";
import { uuidSchema } from "@/server/validation";

export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | DbTx;

/** Everything a service needs to act for a user. `now` is injected for deterministic tests. */
export type ServiceContext = { db: Db; now: Date; userId: string };

export type CircleAccess = {
  circle: typeof careCircles.$inferSelect;
  profile: typeof careProfiles.$inferSelect;
  membership: { id: string; role: CircleRole; isLegalRepresentative: boolean; expiresAt: Date | null };
  can: (capability: Capability) => boolean;
  capabilities: Capability[];
};

const NOT_FOUND = "Care circle not found.";

/**
 * Loads a circle for a user and evaluates their permissions. Anyone without an active,
 * unexpired membership gets 404 — never 403 — so circle existence is not revealed.
 */
export async function loadCircleAccess(db: DbOrTx, circleId: string, userId: string, now: Date): Promise<CircleAccess> {
  if (!uuidSchema.safeParse(circleId).success) throw new AppError("not_found", NOT_FOUND);
  const [row] = await db
    .select({ circle: careCircles, profile: careProfiles, membership: memberships })
    .from(memberships)
    .innerJoin(careCircles, eq(careCircles.id, memberships.circleId))
    .innerJoin(careProfiles, eq(careProfiles.circleId, careCircles.id))
    .where(and(eq(memberships.circleId, circleId), eq(memberships.userId, userId), eq(memberships.status, "active")))
    .limit(1);

  if (!row) throw new AppError("not_found", NOT_FOUND);
  if (row.membership.expiresAt && row.membership.expiresAt.getTime() <= now.getTime()) {
    throw new AppError("not_found", NOT_FOUND);
  }

  const member = { role: row.membership.role, isLegalRepresentative: row.membership.isLegalRepresentative };
  const profileCtx = { selfManaging: row.profile.selfManaging, consent: row.profile.consent };
  return {
    circle: row.circle,
    profile: row.profile,
    membership: {
      id: row.membership.id,
      role: row.membership.role,
      isLegalRepresentative: row.membership.isLegalRepresentative,
      expiresAt: row.membership.expiresAt,
    },
    can: (capability) => can(member, profileCtx, capability),
    capabilities: capabilitiesFor(member, profileCtx),
  };
}

/** Throws 403 unless the member holds the capability. */
export function requireCapability(access: CircleAccess, capability: Capability): void {
  if (!access.can(capability)) {
    throw new AppError("forbidden", "You don't have permission to do this in this care circle.");
  }
}

/** Archived circles are read-only. */
export function requireWritable(access: CircleAccess): void {
  if (access.circle.status === "archived") {
    throw new AppError("conflict", "This care circle is archived and can no longer be changed.");
  }
}

/** Convenience: load, check writability (for mutations) and check a capability in one call. */
export async function authorize(
  ctx: ServiceContext,
  circleId: string,
  capability: Capability,
  options: { write?: boolean } = {},
): Promise<CircleAccess> {
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  requireCapability(access, capability);
  if (options.write) requireWritable(access);
  return access;
}
