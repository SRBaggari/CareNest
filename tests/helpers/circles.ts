import { and, eq } from "drizzle-orm";
import { POST as createCircleRoute } from "@/app/api/v1/circles/route";
import type { CircleRole } from "@/server/auth/permissions";
import type { Db } from "@/server/db";
import { careProfiles, memberships } from "@/server/db/schema";
import { apiRequest } from "./http";
import type { TestUser } from "./users";

export const RECIPIENT = {
  displayName: "Lakshmi Rao",
  preferredName: "Amma",
  dateOfBirth: "1948-03-14",
  timeZone: "Asia/Kolkata",
  country: "IN",
  locale: "te",
  selfManaging: true,
};

/** Creates a circle through the API as `owner` (who becomes admin unless creatorRole says otherwise). */
export async function createTestCircle(
  owner: TestUser,
  overrides: { name?: string; creatorRole?: "admin" | "care_recipient"; recipient?: Partial<typeof RECIPIENT> } = {},
) {
  const res = await createCircleRoute(
    apiRequest("POST", "/api/v1/circles", {
      cookie: owner.cookie,
      body: {
        name: overrides.name ?? "Amma's care",
        creatorRole: overrides.creatorRole,
        recipient: { ...RECIPIENT, ...overrides.recipient },
      },
    }),
  );
  if (res.status !== 201) throw new Error(`createTestCircle failed: ${res.status} ${await res.text()}`);
  return (await res.json()).circle as {
    id: string;
    name: string;
    profile: { version: number; selfManaging: boolean; hasOwnAccount: boolean; dateOfBirth: string | null };
    myMembership: { id: string; role: CircleRole };
    myCapabilities: string[];
  };
}

/**
 * Test fixture: adds a member directly in the database (the invitation flow has its own tests).
 * Returns the membership id.
 */
export async function addMember(
  db: Db,
  circleId: string,
  user: TestUser,
  role: CircleRole,
  options: { isLegalRepresentative?: boolean; expiresAt?: Date | null } = {},
): Promise<string> {
  const [row] = await db
    .insert(memberships)
    .values({
      circleId,
      userId: user.id,
      role,
      isLegalRepresentative: options.isLegalRepresentative ?? false,
      expiresAt: options.expiresAt ?? null,
    })
    .returning({ id: memberships.id });
  if (role === "care_recipient") {
    await db.update(careProfiles).set({ linkedUserId: user.id }).where(eq(careProfiles.circleId, circleId));
  }
  return row.id;
}

export async function membershipStatus(db: Db, circleId: string, userId: string) {
  const [row] = await db
    .select({ status: memberships.status })
    .from(memberships)
    .where(and(eq(memberships.circleId, circleId), eq(memberships.userId, userId)));
  return row?.status;
}

export type Team = Awaited<ReturnType<typeof createTeam>>;

/**
 * A circle with one member of every role: admin (owner), elder (care_recipient), family,
 * caregiver, clinician, neighbour (emergency_contact). Each person has `.memberId`.
 */
export async function createTeam(db: Db) {
  const { signUp } = await import("./users");
  const admin = await signUp({ name: "Priya" });
  const circle = await createTestCircle(admin);
  const make = async (name: string, role: CircleRole) => {
    const user = await signUp({ name });
    return { ...user, memberId: await addMember(db, circle.id, user, role) };
  };
  return {
    circle,
    admin: { ...admin, memberId: circle.myMembership.id },
    elder: await make("Amma", "care_recipient"),
    family: await make("Ravi", "family"),
    caregiver: await make("Meena", "caregiver"),
    clinician: await make("Dr Iyer", "clinician"),
    neighbour: await make("Neighbour", "emergency_contact"),
    as: (user: { id: string }, now: Date) => ({ db, now, userId: user.id }),
  };
}
