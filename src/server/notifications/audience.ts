import { and, eq, gt, isNull, or } from "drizzle-orm";
import { getTranslator, isLocale } from "@/i18n";
import { can, type Capability, type CircleRole } from "@/server/auth/permissions";
import type { DbOrTx } from "@/server/services/access";
import { careProfiles, memberships, users } from "@/server/db/schema";

export type AudienceMember = {
  memberId: string;
  userId: string;
  role: CircleRole;
  locale: string;
  isLegalRepresentative: boolean;
  overrides: typeof memberships.$inferSelect;
  can: (capability: Capability) => boolean;
};

/**
 * Everyone currently in a circle (active, unexpired, account enabled) with their permissions
 * evaluated against the recipient's sharing choices — so alerts never reveal what a person
 * isn't allowed to see in the app.
 */
export async function circleAudience(db: DbOrTx, circleId: string, now: Date): Promise<AudienceMember[]> {
  const [profile] = await db
    .select({ selfManaging: careProfiles.selfManaging, consent: careProfiles.consent })
    .from(careProfiles)
    .where(eq(careProfiles.circleId, circleId));
  if (!profile) return [];
  const rows = await db
    .select({ m: memberships, locale: users.locale })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.circleId, circleId),
        eq(memberships.status, "active"),
        isNull(users.disabledAt),
        or(isNull(memberships.expiresAt), gt(memberships.expiresAt, now)),
      ),
    );
  return rows.map((r) => {
    const member = { role: r.m.role, isLegalRepresentative: r.m.isLegalRepresentative };
    return {
      memberId: r.m.id,
      userId: r.m.userId,
      role: r.m.role,
      locale: r.locale,
      isLegalRepresentative: r.m.isLegalRepresentative,
      overrides: r.m,
      can: (capability: Capability) => can(member, profile, capability),
    };
  });
}

export const translatorFor = (locale: string) => getTranslator(isLocale(locale) ? locale : "en");
export const appUrl = (path: string) => `${process.env.APP_URL ?? "http://localhost:3000"}${path}`;
