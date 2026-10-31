import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as getCircle } from "@/app/api/v1/circles/[circleId]/route";
import { DELETE as revoke } from "@/app/api/v1/circles/[circleId]/invitations/[invitationId]/route";
import { GET as listInvitations, POST as invite } from "@/app/api/v1/circles/[circleId]/invitations/route";
import { DELETE as removeMember } from "@/app/api/v1/circles/[circleId]/members/[memberId]/route";
import { GET as listMembers } from "@/app/api/v1/circles/[circleId]/members/route";
import { POST as accept } from "@/app/api/v1/invitations/[token]/accept/route";
import { GET as preview } from "@/app/api/v1/invitations/[token]/route";
import { invitations } from "@/server/db/schema";
import { addMember, createTestCircle } from "../helpers/circles";
import { setupTestDb } from "../helpers/db";
import { apiRequest, params } from "../helpers/http";
import { signUp, type TestUser } from "../helpers/users";

const db = setupTestDb();

async function sendInvite(owner: TestUser, circleId: string, body: Record<string, unknown>) {
  return invite(apiRequest("POST", `/api/v1/circles/${circleId}/invitations`, { cookie: owner.cookie, body }), params({ circleId }));
}

async function inviteToken(owner: TestUser, circleId: string, body: Record<string, unknown>) {
  const res = await sendInvite(owner, circleId, body);
  if (res.status !== 201) throw new Error(`invite failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { token: json.inviteUrl.split("/invite/")[1] as string, id: json.invitation.id as string, url: json.inviteUrl as string };
}

const acceptAs = (user: TestUser, token: string) =>
  accept(apiRequest("POST", `/api/v1/invitations/${token}/accept`, { cookie: user.cookie }), params({ token }));

describe("Scenario A: a child abroad invites a sibling and a local caregiver", () => {
  it("both join with the right roles and can open the circle", async () => {
    const child = await signUp({ name: "Priya", timeZone: "Europe/London" });
    const circle = await createTestCircle(child);
    const sibling = await signUp({ name: "Ravi", timeZone: "Asia/Kolkata" });
    const caregiver = await signUp({ name: "Meena", timeZone: "Asia/Kolkata" });

    const siblingInvite = await inviteToken(child, circle.id, { email: sibling.email, role: "family" });
    const caregiverInvite = await inviteToken(child, circle.id, { email: caregiver.email, role: "caregiver" });
    expect(siblingInvite.url).toMatch(/^http:\/\/localhost\/invite\/[A-Za-z0-9_-]{43}$/);

    const shown = await (await preview(apiRequest("GET", `/api/v1/invitations/${siblingInvite.token}`), params({ token: siblingInvite.token }))).json();
    expect(shown.invitation).toMatchObject({ circleName: "Amma's care", inviterName: "Priya", role: "family", status: "pending" });

    expect((await acceptAs(sibling, siblingInvite.token)).status).toBe(200);
    expect((await acceptAs(caregiver, caregiverInvite.token)).status).toBe(200);

    const { members } = await (
      await listMembers(apiRequest("GET", `/api/v1/circles/${circle.id}/members`, { cookie: child.cookie }), params({ circleId: circle.id }))
    ).json();
    expect(members.map((m: { name: string; role: string }) => [m.name, m.role])).toEqual([
      ["Priya", "admin"],
      ["Ravi", "family"],
      ["Meena", "caregiver"],
    ]);
    const caregiverView = await getCircle(apiRequest("GET", `/api/v1/circles/${circle.id}`, { cookie: caregiver.cookie }), params({ circleId: circle.id }));
    expect(caregiverView.status).toBe(200);
  });
});

describe("invitation safety", () => {
  it("stores only a hash of the token", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const { token, id } = await inviteToken(owner, circle.id, { email: "x@example.test", role: "family" });
    const [row] = await db().select().from(invitations).where(eq(invitations.id, id));
    expect(row.tokenHash).not.toContain(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("must be accepted with the invited email", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const { token } = await inviteToken(owner, circle.id, { email: "intended@example.test", role: "family" });
    const wrongPerson = await signUp();
    const res = await acceptAs(wrongPerson, token);
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toContain("intended@example.test");
  });

  it("is single-use and idempotent for the person who accepted it", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const invitee = await signUp();
    const { token } = await inviteToken(owner, circle.id, { email: invitee.email, role: "family" });
    expect((await acceptAs(invitee, token)).status).toBe(200);
    expect((await acceptAs(invitee, token)).status).toBe(200);
    const status = (await (await preview(apiRequest("GET", `/api/v1/invitations/${token}`), params({ token }))).json()).invitation.status;
    expect(status).toBe("accepted");
  });

  it("cannot be accepted after it expires or is revoked", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const a = await signUp();
    const b = await signUp();
    const expired = await inviteToken(owner, circle.id, { email: a.email, role: "family" });
    await db().update(invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitations.id, expired.id));
    const expiredRes = await acceptAs(a, expired.token);
    expect(expiredRes.status).toBe(409);
    expect((await expiredRes.json()).error.message).toMatch(/expired/);

    const revoked = await inviteToken(owner, circle.id, { email: b.email, role: "family" });
    const del = await revoke(
      apiRequest("DELETE", `/api/v1/circles/${circle.id}/invitations/${revoked.id}`, { cookie: owner.cookie }),
      params({ circleId: circle.id, invitationId: revoked.id }),
    );
    expect(del.status).toBe(204);
    expect((await acceptAs(b, revoked.token)).status).toBe(409);
  });

  it("a newer invitation to the same email replaces the older link", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const invitee = await signUp();
    const first = await inviteToken(owner, circle.id, { email: invitee.email, role: "family" });
    const second = await inviteToken(owner, circle.id, { email: invitee.email, role: "caregiver" });
    expect((await acceptAs(invitee, first.token)).status).toBe(409);
    expect((await acceptAs(invitee, second.token)).status).toBe(200);
  });

  it("returns 404 for unknown tokens", async () => {
    const res = await preview(apiRequest("GET", "/api/v1/invitations/made-up"), params({ token: "made-up" }));
    expect(res.status).toBe(404);
  });

  it("two simultaneous accepts cannot both create memberships", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const invitee = await signUp();
    const { token } = await inviteToken(owner, circle.id, { email: invitee.email, role: "family" });
    const results = await Promise.all([acceptAs(invitee, token), acceptAs(invitee, token)]);
    expect(results.map((r) => r.status).sort()).toEqual(expect.arrayContaining([200]));
    const { members } = await (
      await listMembers(apiRequest("GET", `/api/v1/circles/${circle.id}/members`, { cookie: owner.cookie }), params({ circleId: circle.id }))
    ).json();
    expect(members.filter((m: { userId: string }) => m.userId === invitee.id)).toHaveLength(1);
  });
});

describe("who may invite", () => {
  it("only people who manage members, and never outsiders", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const family = await signUp();
    await addMember(db(), circle.id, family, "family");
    const stranger = await signUp();
    expect((await sendInvite(family, circle.id, { email: "a@example.test", role: "family" })).status).toBe(403);
    expect((await sendInvite(stranger, circle.id, { email: "a@example.test", role: "admin" })).status).toBe(404);
    expect(
      (await listInvitations(apiRequest("GET", `/api/v1/circles/${circle.id}/invitations`, { cookie: family.cookie }), params({ circleId: circle.id }))).status,
    ).toBe(403);
  });

  it("refuses to invite an existing member", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    expect((await sendInvite(owner, circle.id, { email: owner.email, role: "family" })).status).toBe(409);
  });

  it("validates email and role", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const res = await sendInvite(owner, circle.id, { email: "nope", role: "boss" });
    expect(res.status).toBe(422);
    expect(Object.keys((await res.json()).error.details).sort()).toEqual(["email", "role"]);
  });

  it("lists pending invitations and hides accepted ones", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const invitee = await signUp();
    const accepted = await inviteToken(owner, circle.id, { email: invitee.email, role: "family" });
    await inviteToken(owner, circle.id, { email: "pending@example.test", role: "clinician" });
    await acceptAs(invitee, accepted.token);
    const { invitations: pending } = await (
      await listInvitations(apiRequest("GET", `/api/v1/circles/${circle.id}/invitations`, { cookie: owner.cookie }), params({ circleId: circle.id }))
    ).json();
    expect(pending.map((i: { email: string }) => i.email)).toEqual(["pending@example.test"]);
  });
});

describe("special roles", () => {
  it("links the care recipient's own account when they accept, and only once", async () => {
    const child = await signUp();
    const circle = await createTestCircle(child);
    const elder = await signUp({ name: "Lakshmi" });
    const { token } = await inviteToken(child, circle.id, { email: elder.email, role: "care_recipient" });
    expect((await acceptAs(elder, token)).status).toBe(200);
    const view = await (await getCircle(apiRequest("GET", `/api/v1/circles/${circle.id}`, { cookie: elder.cookie }), params({ circleId: circle.id }))).json();
    expect(view.circle.profile.hasOwnAccount).toBe(true);
    expect(view.circle.myCapabilities).toContain("consent.manage");

    expect((await sendInvite(child, circle.id, { email: "someone@example.test", role: "care_recipient" })).status).toBe(409);
  });

  it("temporary access from an invitation carries over to the membership", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const relief = await signUp();
    const until = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    const { token } = await inviteToken(owner, circle.id, { email: relief.email, role: "caregiver", accessExpiresAt: until });
    await acceptAs(relief, token);
    const { members } = await (
      await listMembers(apiRequest("GET", `/api/v1/circles/${circle.id}/members`, { cookie: owner.cookie }), params({ circleId: circle.id }))
    ).json();
    expect(new Date(members.find((m: { userId: string }) => m.userId === relief.id).expiresAt).toISOString()).toBe(until);

    expect((await sendInvite(owner, circle.id, { email: "late@example.test", role: "caregiver", accessExpiresAt: "2001-01-01T00:00:00Z" })).status).toBe(422);
  });

  it("a removed member can be invited back", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const member = await signUp();
    const memberId = await addMember(db(), circle.id, member, "caregiver");
    await removeMember(
      apiRequest("DELETE", `/api/v1/circles/${circle.id}/members/${memberId}`, { cookie: owner.cookie }),
      params({ circleId: circle.id, memberId }),
    );
    const { token } = await inviteToken(owner, circle.id, { email: member.email, role: "family" });
    expect((await acceptAs(member, token)).status).toBe(200);
    const view = await (await getCircle(apiRequest("GET", `/api/v1/circles/${circle.id}`, { cookie: member.cookie }), params({ circleId: circle.id }))).json();
    expect(view.circle.myMembership.role).toBe("family");
  });
});
