import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST as raiseRoute } from "@/app/api/v1/circles/[circleId]/emergency/requests/route";
import { GET as getRoute } from "@/app/api/v1/circles/[circleId]/emergency/requests/[requestId]/route";
import { notifications } from "@/server/db/schema";
import { deliverPendingEmails } from "@/server/notifications/email";
import { acknowledgeAssistance, cancelAssistance, escalateAssistance, getAssistance, raiseAssistance, resolveAssistance } from "@/server/services/assistance";
import { createEmergencyContact } from "@/server/services/emergency";
import { markRead, updatePreferences } from "@/server/services/notifications";
import { runTick } from "@/server/worker/tick";
import { createTeam, createTestCircle, type Team } from "../helpers/circles";
import { setupTestDb } from "../helpers/db";
import { setupFakeEmail } from "../helpers/email";
import { apiRequest, params } from "../helpers/http";
import { signUp } from "../helpers/users";

const db = setupTestDb();
const email = setupFakeEmail();
const T0 = new Date("2026-11-14T17:00:00Z"); // 22:30 in Kolkata
const min = (m: number) => new Date(T0.getTime() + m * 60_000);

async function alerts(user: { id: string }, kind = "assistance_alert") {
  return (await db().select().from(notifications).where(eq(notifications.userId, user.id))).filter((n) => n.kind === kind);
}

/** Ravi (family) is tier 1, Priya (admin) tier 2, plus a neighbour with no account. */
async function tieredTeam(): Promise<Team> {
  const team = await createTeam(db());
  const { admin, family, circle, as } = team;
  await createEmergencyContact(as(admin, T0), circle.id, { name: "Ravi", phone: "+91 90000 00001", tier: 1, memberId: family.memberId });
  await createEmergencyContact(as(admin, T0), circle.id, { name: "Priya", phone: "+44 7000 000000", tier: 2, memberId: admin.memberId });
  await createEmergencyContact(as(admin, T0), circle.id, { name: "Mrs Reddy (neighbour)", phone: "+91 90000 00009", tier: 1 });
  return team;
}

describe("Scenario E: emergency assistance", () => {
  it("alerts tier 1 first, escalates tier by tier when nobody responds, and never claims to have called emergency services", async () => {
    const { elder, family, admin, caregiver, clinician, neighbour, circle, as } = await tieredTeam();
    const req = await raiseAssistance(as(elder, T0), circle.id, { message: "I fell in the bathroom" });
    expect(req).toMatchObject({ status: "open", alreadyOpen: false, raisedBy: "Amma" });

    const [first] = await alerts(family);
    expect(first).toMatchObject({ priority: "critical", title: "Amma asked for help" });
    expect(first.body).toContain("“I fell in the bathroom”");
    expect(first.body).toContain("CareNest has NOT contacted emergency services");
    expect(first.body).toContain("call 112");
    for (const u of [admin, caregiver, clinician, neighbour, elder]) expect(await alerts(u)).toHaveLength(0);

    await escalateAssistance(db(), min(4));
    expect(await alerts(admin)).toHaveLength(0);
    await escalateAssistance(db(), min(5));
    expect(await alerts(admin)).toHaveLength(1);
    await escalateAssistance(db(), min(10));
    for (const u of [caregiver, clinician, neighbour]) expect(await alerts(u)).toHaveLength(1);
    await escalateAssistance(db(), min(15));
    expect((await alerts(family)).map((n) => n.title)).toEqual(["Amma asked for help", "Still no response: Amma needs help"]);
    expect(await alerts(elder)).toHaveLength(0);
    await escalateAssistance(db(), min(30));
    expect(await alerts(family)).toHaveLength(2);
  });

  it("'I'm responding' stops escalation and tells everyone alerted so far, including the person who asked", async () => {
    const { elder, family, admin, circle, as } = await tieredTeam();
    const req = await raiseAssistance(as(elder, T0), circle.id, {});
    const acked = await acknowledgeAssistance(as(family, min(2)), circle.id, req.id);
    expect(acked).toMatchObject({ status: "acknowledged", acknowledgedBy: "Ravi" });
    await escalateAssistance(db(), min(10));
    expect(await alerts(admin)).toHaveLength(0);
    expect((await alerts(elder, "assistance_ack"))[0].title).toBe("Ravi is responding to Amma's request for help");

    const resolved = await resolveAssistance(as(family, min(20)), circle.id, req.id, { note: "Helped her up, no injury. Doctor visit tomorrow." });
    expect(resolved).toMatchObject({ status: "resolved", resolvedBy: "Ravi", resolutionNote: "Helped her up, no injury. Doctor visit tomorrow." });
    expect(await alerts(elder, "assistance_resolved")).toHaveLength(1);
  });

  it("critical alerts are emailed even during quiet hours", async () => {
    const { elder, family, circle, as } = await tieredTeam();
    await updatePreferences(as(family, T0), { emailEnabled: true, quietStart: "22:00", quietEnd: "07:00" });
    await raiseAssistance(as(elder, T0), circle.id, {});
    await deliverPendingEmails(db(), T0);
    const sent = email().sent.find((e) => e.to === family.email)!;
    expect(sent.subject).toBe("URGENT: Amma needs help");
    expect(sent.text).toContain("CareNest has NOT contacted emergency services");
  });

  it("pressing the button again doesn't start a second alarm", async () => {
    const { elder, family, circle, as } = await tieredTeam();
    const first = await raiseAssistance(as(elder, T0), circle.id, {});
    const again = await raiseAssistance(as(elder, min(1)), circle.id, {});
    expect(again).toMatchObject({ id: first.id, alreadyOpen: true });
    expect(await alerts(family)).toHaveLength(1);
  });

  it("with no tiers configured, everyone who can see emergencies is alerted at once", async () => {
    const { family, admin, caregiver, neighbour, elder, circle, as } = await createTeam(db());
    await raiseAssistance(as(caregiver, T0), circle.id, { message: "Amma has chest pain, ambulance called" });
    for (const u of [family, admin, neighbour, elder]) expect((await alerts(u))[0]?.title).toBe("Meena needs help");
    expect(await alerts(caregiver)).toHaveLength(0);
  });
});

describe("visibility of delivery and silence", () => {
  it("reports who was alerted, who has seen it, email status, and contacts to phone by hand", async () => {
    const { elder, family, admin, circle, as } = await tieredTeam();
    const req = await raiseAssistance(as(elder, T0), circle.id, {});
    await escalateAssistance(db(), min(5));
    const [familyAlert] = await alerts(family);
    await markRead(as(family, min(6)), familyAlert.id);
    await deliverPendingEmails(db(), min(6));

    const detail = await getAssistance(as(admin, min(7)), circle.id, req.id);
    expect(detail.deliveries.map((d) => [d.name, d.seenAt !== null, d.emailStatus])).toEqual([
      ["Ravi", true, "sent"],
      ["Priya", false, "sent"],
    ]);
    expect(detail.contactsWithoutAlerts).toEqual([{ name: "Mrs Reddy (neighbour)", phone: "+91 90000 00009", relationship: null, tier: 1 }]);
    expect(detail.status).toBe("open");
    expect(detail.nextEscalationAt?.toISOString()).toBe(min(10).toISOString());
  });
});

describe("rules", () => {
  it("practice alerts are labelled and never escalate", async () => {
    const { elder, family, admin, circle, as } = await tieredTeam();
    await raiseAssistance(as(elder, T0), circle.id, { practice: true });
    expect((await alerts(family))[0].title).toBe("[PRACTICE] Amma asked for help");
    await escalateAssistance(db(), min(30));
    expect(await alerts(admin)).toHaveLength(0);
    // A practice drill doesn't block a real request.
    expect((await raiseAssistance(as(elder, min(31)), circle.id, {})).alreadyOpen).toBe(false);
  });

  it("only the person who asked or an admin can call it a false alarm", async () => {
    const { elder, family, admin, circle, as } = await tieredTeam();
    const req = await raiseAssistance(as(elder, T0), circle.id, {});
    await expect(cancelAssistance(as(family, min(1)), circle.id, req.id)).rejects.toMatchObject({ code: "forbidden" });
    expect((await cancelAssistance(as(elder, min(1)), circle.id, req.id)).status).toBe("cancelled");
    expect((await alerts(family, "assistance_cancelled"))[0].title).toBe("False alarm: Amma's request for help was cancelled");
    await expect(acknowledgeAssistance(as(admin, min(2)), circle.id, req.id)).rejects.toMatchObject({ code: "conflict" });
  });

  it("emergency contacts can raise and respond; clinicians can view but not raise", async () => {
    const { neighbour, clinician, family, circle, as } = await createTeam(db());
    await expect(raiseAssistance(as(clinician, T0), circle.id, {})).rejects.toMatchObject({ code: "forbidden" });
    const req = await raiseAssistance(as(neighbour, T0), circle.id, {});
    expect((await acknowledgeAssistance(as(family, min(1)), circle.id, req.id)).acknowledgedBy).toBe("Ravi");
    expect((await getAssistance(as(clinician, min(2)), circle.id, req.id)).status).toBe("acknowledged");
  });

  it("location is only stored when shared, and is validated", async () => {
    const { elder, family, circle, as } = await createTeam(db());
    const req = await raiseAssistance(as(elder, T0), circle.id, { location: { latitude: 17.43, longitude: 78.41, accuracyMeters: 20 } });
    expect(req.location).toEqual({ latitude: 17.43, longitude: 78.41, accuracyMeters: 20 });
    expect((await alerts(family))[0].body).toContain("openstreetmap.org/?mlat=17.43&mlon=78.41");
    await expect(raiseAssistance(as(elder, T0), circle.id, { location: { latitude: 200, longitude: 0 } })).rejects.toMatchObject({ name: "ZodError" });
  });

  it("the worker escalates, and overlapping ticks don't double-alert", async () => {
    const { elder, admin, circle, as } = await tieredTeam();
    await raiseAssistance(as(elder, T0), circle.id, {});
    await Promise.all([runTick(db(), min(5)), runTick(db(), min(5)), runTick(db(), min(5))]);
    expect(await alerts(admin)).toHaveLength(1);
  });

  it("outsiders get 404, including with another circle's request id", async () => {
    const { elder, circle, as } = await createTeam(db());
    const req = await raiseAssistance(as(elder, T0), circle.id, {});
    const outsider = await signUp();
    const own = await createTestCircle(outsider);
    expect((await raiseRoute(apiRequest("POST", `/api/v1/circles/${circle.id}/emergency/requests`, { cookie: outsider.cookie, body: {} }), params({ circleId: circle.id }))).status).toBe(404);
    expect(
      (await getRoute(apiRequest("GET", `/api/v1/circles/${own.id}/emergency/requests/${req.id}`, { cookie: outsider.cookie }), params({ circleId: own.id, requestId: req.id }))).status,
    ).toBe(404);
  });
});
