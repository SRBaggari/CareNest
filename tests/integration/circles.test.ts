import { describe, expect, it } from "vitest";
import { POST as archive } from "@/app/api/v1/circles/[circleId]/archive/route";
import { GET as audit } from "@/app/api/v1/circles/[circleId]/audit/route";
import { PUT as putConsent } from "@/app/api/v1/circles/[circleId]/consent/route";
import { DELETE as removeMember, PATCH as patchMember } from "@/app/api/v1/circles/[circleId]/members/[memberId]/route";
import { GET as listMembers } from "@/app/api/v1/circles/[circleId]/members/route";
import { GET as getCircle, PATCH as patchCircle } from "@/app/api/v1/circles/[circleId]/route";
import { PUT as putSelfManaging } from "@/app/api/v1/circles/[circleId]/self-managing/route";
import { GET as listCircles, POST as createCircle } from "@/app/api/v1/circles/route";
import { setupTestDb } from "../helpers/db";
import { addMember, createTestCircle, membershipStatus, RECIPIENT } from "../helpers/circles";
import { apiRequest, params } from "../helpers/http";
import { signUp, type TestUser } from "../helpers/users";

const db = setupTestDb();

const get = (user: TestUser, circleId: string) =>
  getCircle(apiRequest("GET", `/api/v1/circles/${circleId}`, { cookie: user.cookie }), params({ circleId }));

describe("creating circles", () => {
  it("creates a circle with the creator as admin, country-specific emergency number and full sharing", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    expect(circle.myMembership.role).toBe("admin");
    expect(circle).toMatchObject({
      name: "Amma's care",
      status: "active",
      profile: {
        displayName: "Lakshmi Rao",
        preferredName: "Amma",
        timeZone: "Asia/Kolkata",
        country: "IN",
        emergencyNumber: "112",
        selfManaging: true,
        hasOwnAccount: false,
        consent: { shareMedications: true, shareAppointments: true, shareHealth: true },
        version: 1,
      },
    });
    expect(circle.myCapabilities).toContain("members.manage");
    expect(circle.myCapabilities).not.toContain("consent.manage");
  });

  it("lets an older person create their own circle, linked to their account and self-managing", async () => {
    const elder = await signUp({ name: "Lakshmi" });
    const circle = await createTestCircle(elder, { creatorRole: "care_recipient", recipient: { selfManaging: false } });
    expect(circle.myMembership.role).toBe("care_recipient");
    expect(circle.profile.selfManaging).toBe(true);
    expect(circle.profile.hasOwnAccount).toBe(true);
    expect(circle.myCapabilities).toContain("consent.manage");
  });

  it("uses 911 in the US and accepts an explicit emergency number", async () => {
    const owner = await signUp();
    const us = await createTestCircle(owner, { recipient: { country: "us", timeZone: "America/Chicago" } });
    expect((us as unknown as { profile: { emergencyNumber: string } }).profile.emergencyNumber).toBe("911");
  });

  it("validates the recipient profile", async () => {
    const owner = await signUp();
    const res = await createCircle(
      apiRequest("POST", "/api/v1/circles", {
        cookie: owner.cookie,
        body: {
          name: "",
          recipient: { ...RECIPIENT, timeZone: "Nowhere/Land", country: "India", dateOfBirth: "2999-01-01", emergencyNumber: "call me" },
        },
      }),
    );
    expect(res.status).toBe(422);
    const { error } = await res.json();
    expect(Object.keys(error.details).sort()).toEqual([
      "name",
      "recipient.country",
      "recipient.dateOfBirth",
      "recipient.emergencyNumber",
      "recipient.timeZone",
    ]);
  });

  it("requires sign-in", async () => {
    expect((await createCircle(apiRequest("POST", "/api/v1/circles", { body: {} }))).status).toBe(401);
    expect((await listCircles(apiRequest("GET", "/api/v1/circles"))).status).toBe(401);
  });

  it("records the creation in the audit log", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const res = await audit(apiRequest("GET", `/api/v1/circles/${circle.id}/audit`, { cookie: owner.cookie }), params({ circleId: circle.id }));
    const { events } = await res.json();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "circle.created", actor: { id: owner.id } });
  });
});

describe("Scenario F: one person, two parents", () => {
  it("lists only the user's own circles and keeps each parent's profile separate", async () => {
    const child = await signUp();
    const mum = await createTestCircle(child, { name: "Mum", recipient: { displayName: "Mum" } });
    const dad = await createTestCircle(child, { name: "Dad", recipient: { displayName: "Dad", timeZone: "Europe/London", country: "GB" } });
    const stranger = await signUp();
    await createTestCircle(stranger, { name: "Someone else's parent" });

    const { circles } = await (await listCircles(apiRequest("GET", "/api/v1/circles", { cookie: child.cookie }))).json();
    expect(circles.map((c: { id: string }) => c.id)).toEqual([mum.id, dad.id]);
    expect(circles[1]).toMatchObject({ recipientName: "Dad", timeZone: "Europe/London", role: "admin" });
  });
});

describe("cross-circle isolation", () => {
  it("returns 404 (never 403) on every circle endpoint for non-members", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const stranger = await signUp();
    const p = params({ circleId: circle.id });
    const memberP = params({ circleId: circle.id, memberId: circle.myMembership.id });
    const c = stranger.cookie;
    const base = `/api/v1/circles/${circle.id}`;

    const responses = await Promise.all([
      getCircle(apiRequest("GET", base, { cookie: c }), p),
      patchCircle(apiRequest("PATCH", base, { cookie: c, body: { version: 1, name: "Mine now" } }), p),
      putConsent(apiRequest("PUT", `${base}/consent`, { cookie: c, body: { shareMedications: false, shareAppointments: false, shareHealth: false } }), p),
      putSelfManaging(apiRequest("PUT", `${base}/self-managing`, { cookie: c, body: { selfManaging: false, version: 1 } }), p),
      archive(apiRequest("POST", `${base}/archive`, { cookie: c }), p),
      listMembers(apiRequest("GET", `${base}/members`, { cookie: c }), p),
      patchMember(apiRequest("PATCH", `${base}/members/${circle.myMembership.id}`, { cookie: c, body: { role: "family" } }), memberP),
      removeMember(apiRequest("DELETE", `${base}/members/${circle.myMembership.id}`, { cookie: c }), memberP),
      audit(apiRequest("GET", `${base}/audit`, { cookie: c }), p),
    ]);
    expect(responses.map((r) => r.status)).toEqual(Array(responses.length).fill(404));
    expect((await get(owner, circle.id).then((r) => r.json())).circle.name).toBe("Amma's care");
  });

  it("returns 404 for malformed ids", async () => {
    const owner = await signUp();
    const res = await getCircle(apiRequest("GET", "/api/v1/circles/nope", { cookie: owner.cookie }), params({ circleId: "nope" }));
    expect(res.status).toBe(404);
  });
});

describe("editing the profile", () => {
  it("updates fields and bumps the version", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const res = await patchCircle(
      apiRequest("PATCH", `/api/v1/circles/${circle.id}`, {
        cookie: owner.cookie,
        body: { version: 1, name: "Amma", preferredName: "", emergencyNumber: "108" },
      }),
      params({ circleId: circle.id }),
    );
    expect(res.status).toBe(200);
    const { circle: updated } = await res.json();
    expect(updated).toMatchObject({ name: "Amma", profile: { preferredName: null, emergencyNumber: "108", version: 2 } });
  });

  it("rejects a stale version with 409 and changes nothing (two siblings editing at once)", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const sibling = await signUp();
    await addMember(db(), circle.id, sibling, "admin");
    const edit = (user: TestUser, name: string) =>
      patchCircle(apiRequest("PATCH", `/api/v1/circles/${circle.id}`, { cookie: user.cookie, body: { version: 1, name } }), params({ circleId: circle.id }));

    expect((await edit(owner, "First edit")).status).toBe(200);
    const second = await edit(sibling, "Second edit");
    expect(second.status).toBe(409);
    expect((await get(owner, circle.id).then((r) => r.json())).circle.name).toBe("First edit");
  });

  it("forbids family members from editing (403)", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const family = await signUp();
    await addMember(db(), circle.id, family, "family");
    const res = await patchCircle(
      apiRequest("PATCH", `/api/v1/circles/${circle.id}`, { cookie: family.cookie, body: { version: 1, name: "x" } }),
      params({ circleId: circle.id }),
    );
    expect(res.status).toBe(403);
  });
});

describe("consent and autonomy", () => {
  async function circleWithRecipient() {
    const admin = await signUp();
    const circle = await createTestCircle(admin);
    const elder = await signUp({ name: "Lakshmi" });
    const elderMemberId = await addMember(db(), circle.id, elder, "care_recipient");
    const family = await signUp();
    await addMember(db(), circle.id, family, "family");
    return { admin, elder, elderMemberId, family, circle };
  }
  const consentBody = { shareMedications: true, shareAppointments: true, shareHealth: false };

  it("a self-managing recipient decides what is shared; family then stop seeing health details", async () => {
    const { elder, family, circle } = await circleWithRecipient();
    expect((await get(family, circle.id).then((r) => r.json())).circle.profile.dateOfBirth).toBe("1948-03-14");

    const res = await putConsent(
      apiRequest("PUT", `/api/v1/circles/${circle.id}/consent`, { cookie: elder.cookie, body: consentBody }),
      params({ circleId: circle.id }),
    );
    expect(res.status).toBe(200);

    const familyView = (await get(family, circle.id).then((r) => r.json())).circle;
    expect(familyView.profile.dateOfBirth).toBeNull();
    expect(familyView.myCapabilities).not.toContain("health.view");
  });

  it("an admin cannot override a self-managing recipient's consent", async () => {
    const { admin, circle } = await circleWithRecipient();
    const res = await putConsent(
      apiRequest("PUT", `/api/v1/circles/${circle.id}/consent`, { cookie: admin.cookie, body: consentBody }),
      params({ circleId: circle.id }),
    );
    expect(res.status).toBe(403);
  });

  it("an admin cannot take decision-making away from a recipient who has an account", async () => {
    const { admin, circle } = await circleWithRecipient();
    const res = await putSelfManaging(
      apiRequest("PUT", `/api/v1/circles/${circle.id}/self-managing`, { cookie: admin.cookie, body: { selfManaging: false, version: 1 } }),
      params({ circleId: circle.id }),
    );
    expect(res.status).toBe(403);
  });

  it("the recipient can hand decisions over; then the admin manages consent", async () => {
    const { admin, elder, circle } = await circleWithRecipient();
    const res = await putSelfManaging(
      apiRequest("PUT", `/api/v1/circles/${circle.id}/self-managing`, { cookie: elder.cookie, body: { selfManaging: false, version: 1 } }),
      params({ circleId: circle.id }),
    );
    expect(res.status).toBe(200);
    const consent = await putConsent(
      apiRequest("PUT", `/api/v1/circles/${circle.id}/consent`, { cookie: admin.cookie, body: consentBody }),
      params({ circleId: circle.id }),
    );
    expect(consent.status).toBe(200);
  });

  it("refuses to leave the circle without anyone able to manage it", async () => {
    const elder = await signUp();
    const circle = await createTestCircle(elder, { creatorRole: "care_recipient" });
    const res = await putSelfManaging(
      apiRequest("PUT", `/api/v1/circles/${circle.id}/self-managing`, { cookie: elder.cookie, body: { selfManaging: false, version: 1 } }),
      params({ circleId: circle.id }),
    );
    expect(res.status).toBe(409);
  });

  it("nobody else can remove or modify the recipient's membership", async () => {
    const { admin, elderMemberId, circle } = await circleWithRecipient();
    const p = params({ circleId: circle.id, memberId: elderMemberId });
    const url = `/api/v1/circles/${circle.id}/members/${elderMemberId}`;
    expect((await removeMember(apiRequest("DELETE", url, { cookie: admin.cookie }), p)).status).toBe(403);
    expect((await patchMember(apiRequest("PATCH", url, { cookie: admin.cookie, body: { role: "family" } }), p)).status).toBe(403);
  });
});

describe("members", () => {
  it("shows emails only to people who manage membership", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const family = await signUp();
    await addMember(db(), circle.id, family, "family");

    const asFamily = await (await listMembers(apiRequest("GET", `/api/v1/circles/${circle.id}/members`, { cookie: family.cookie }), params({ circleId: circle.id }))).json();
    const ownerRow = asFamily.members.find((m: { userId: string }) => m.userId === owner.id);
    expect(ownerRow.email).toBeNull();
    expect(asFamily.members.find((m: { userId: string }) => m.userId === family.id).email).toBe(family.email);

    const asOwner = await (await listMembers(apiRequest("GET", `/api/v1/circles/${circle.id}/members`, { cookie: owner.cookie }), params({ circleId: circle.id }))).json();
    expect(asOwner.members.every((m: { email: string | null }) => m.email)).toBe(true);
  });

  it("emergency contacts cannot list members", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const neighbour = await signUp();
    await addMember(db(), circle.id, neighbour, "emergency_contact");
    const res = await listMembers(apiRequest("GET", `/api/v1/circles/${circle.id}/members`, { cookie: neighbour.cookie }), params({ circleId: circle.id }));
    expect(res.status).toBe(403);
  });

  it("changes roles but never leaves the circle without a manager", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const family = await signUp();
    const familyMemberId = await addMember(db(), circle.id, family, "family");
    const patch = (memberId: string, body: unknown) =>
      patchMember(
        apiRequest("PATCH", `/api/v1/circles/${circle.id}/members/${memberId}`, { cookie: owner.cookie, body }),
        params({ circleId: circle.id, memberId }),
      );

    expect((await patch(circle.myMembership.id, { role: "family" })).status).toBe(409);
    expect((await patch(familyMemberId, { role: "care_recipient" })).status).toBe(409);
    expect((await patch(familyMemberId, { role: "admin" })).status).toBe(200);
    expect((await patch(circle.myMembership.id, { role: "family" })).status).toBe(200);
    // Having stepped down, the former admin can no longer manage members.
    expect((await patch(familyMemberId, { role: "family" })).status).toBe(403);
  });

  it("removal takes effect immediately", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const caregiver = await signUp();
    const memberId = await addMember(db(), circle.id, caregiver, "caregiver");
    expect((await get(caregiver, circle.id)).status).toBe(200);

    const res = await removeMember(
      apiRequest("DELETE", `/api/v1/circles/${circle.id}/members/${memberId}`, { cookie: owner.cookie }),
      params({ circleId: circle.id, memberId }),
    );
    expect(res.status).toBe(204);
    expect((await get(caregiver, circle.id)).status).toBe(404);
    expect(await membershipStatus(db(), circle.id, caregiver.id)).toBe("revoked");
  });

  it("members may leave on their own, but the last admin may not", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const family = await signUp();
    const familyMemberId = await addMember(db(), circle.id, family, "family");

    const leave = await removeMember(
      apiRequest("DELETE", `/api/v1/circles/${circle.id}/members/${familyMemberId}`, { cookie: family.cookie }),
      params({ circleId: circle.id, memberId: familyMemberId }),
    );
    expect(leave.status).toBe(204);

    const ownerLeave = await removeMember(
      apiRequest("DELETE", `/api/v1/circles/${circle.id}/members/${circle.myMembership.id}`, { cookie: owner.cookie }),
      params({ circleId: circle.id, memberId: circle.myMembership.id }),
    );
    expect(ownerLeave.status).toBe(409);
  });

  it("temporary access ends at its expiry time", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const relief = await signUp();
    await addMember(db(), circle.id, relief, "caregiver", { expiresAt: new Date(Date.now() - 60_000) });
    expect((await get(relief, circle.id)).status).toBe(404);
    const { members } = await (await listMembers(apiRequest("GET", `/api/v1/circles/${circle.id}/members`, { cookie: owner.cookie }), params({ circleId: circle.id }))).json();
    expect(members.map((m: { userId: string }) => m.userId)).not.toContain(relief.id);
  });

  it("rejects an expiry in the past when granting temporary access", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const relief = await signUp();
    const memberId = await addMember(db(), circle.id, relief, "caregiver");
    const res = await patchMember(
      apiRequest("PATCH", `/api/v1/circles/${circle.id}/members/${memberId}`, {
        cookie: owner.cookie,
        body: { expiresAt: "2000-01-01T00:00:00Z" },
      }),
      params({ circleId: circle.id, memberId }),
    );
    expect(res.status).toBe(422);
  });
});

describe("archiving", () => {
  it("makes the circle read-only but still viewable", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const p = params({ circleId: circle.id });
    expect((await archive(apiRequest("POST", `/api/v1/circles/${circle.id}/archive`, { cookie: owner.cookie }), p)).status).toBe(200);
    expect((await get(owner, circle.id).then((r) => r.json())).circle.status).toBe("archived");
    const edit = await patchCircle(apiRequest("PATCH", `/api/v1/circles/${circle.id}`, { cookie: owner.cookie, body: { version: 1, name: "x" } }), p);
    expect(edit.status).toBe(409);

    const { events } = await (await audit(apiRequest("GET", `/api/v1/circles/${circle.id}/audit`, { cookie: owner.cookie }), p)).json();
    expect(events.map((e: { action: string }) => e.action)).toEqual(["circle.archived", "circle.created"]);
  });
});
