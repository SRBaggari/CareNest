import { describe, expect, it } from "vitest";
import { DELETE as deleteContactRoute } from "@/app/api/v1/circles/[circleId]/emergency/contacts/[contactId]/route";
import { GET as infoRoute, PUT as putInfoRoute } from "@/app/api/v1/circles/[circleId]/emergency/info/route";
import { removeMember } from "@/server/services/members";
import { createEmergencyContact, getEmergencyInfo, listEmergencyContacts, updateEmergencyContact, updateEmergencyInfo } from "@/server/services/emergency";
import { createTeam, createTestCircle } from "../helpers/circles";
import { putConsentFor } from "../helpers/consent";
import { setupTestDb } from "../helpers/db";
import { apiRequest, params } from "../helpers/http";
import { signUp } from "../helpers/users";

const db = setupTestDb();
const T0 = new Date("2026-11-14T04:00:00Z");

describe("emergency information card", () => {
  it("managers fill it in; everyone in the circle, including emergency contacts, can read it", async () => {
    const { admin, neighbour, caregiver, circle, as } = await createTeam(db());
    await updateEmergencyInfo(as(admin, T0), circle.id, {
      conditions: "Type 2 diabetes, high blood pressure",
      allergies: "Penicillin",
      bloodGroup: "B+",
      doctorName: "Dr Iyer",
      doctorPhone: "+91 98480 12345",
      preferredHospital: "Apollo, Jubilee Hills",
    });
    const card = await getEmergencyInfo(as(neighbour, T0), circle.id);
    expect(card).toMatchObject({ emergencyNumber: "112", info: { allergies: "Penicillin", bloodGroup: "B+" }, updatedBy: "Priya" });
    await expect(updateEmergencyInfo(as(caregiver, T0), circle.id, { allergies: "x" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("the parent manages their own card when they manage their own care", async () => {
    const { elder, circle, as } = await createTeam(db());
    expect((await updateEmergencyInfo(as(elder, T0), circle.id, { communicationNote: "Speaks Telugu; hard of hearing on the left" })).info.communicationNote).toBe(
      "Speaks Telugu; hard of hearing on the left",
    );
  });

  it("date of birth follows the health-sharing choice", async () => {
    const { elder, neighbour, family, circle, as } = await createTeam(db());
    expect((await getEmergencyInfo(as(family, T0), circle.id)).recipient.dateOfBirth).toBe("1948-03-14");
    expect((await getEmergencyInfo(as(neighbour, T0), circle.id)).recipient.dateOfBirth).toBeNull();
    await putConsentFor(elder, circle.id, { shareMedications: true, shareAppointments: true, shareHealth: false });
    expect((await getEmergencyInfo(as(family, T0), circle.id)).recipient.dateOfBirth).toBeNull();
  });

  it("validates lengths and is 404 for outsiders", async () => {
    const { admin, circle } = await createTeam(db());
    const bad = await putInfoRoute(apiRequest("PUT", `/api/v1/circles/${circle.id}/emergency/info`, { cookie: admin.cookie, body: { bloodGroup: "x".repeat(20) } }), params({ circleId: circle.id }));
    expect(bad.status).toBe(422);
    const outsider = await signUp();
    expect((await infoRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/emergency/info`, { cookie: outsider.cookie }), params({ circleId: circle.id }))).status).toBe(404);
  });
});

describe("emergency contacts", () => {
  it("lists contacts by tier and shows which ones receive alerts automatically", async () => {
    const { admin, family, circle, as } = await createTeam(db());
    await createEmergencyContact(as(admin, T0), circle.id, { name: "Mrs Reddy (neighbour)", phone: "+91 90000 00001", relationship: "Neighbour", tier: 2 });
    await createEmergencyContact(as(admin, T0), circle.id, { name: "Ravi", phone: "+91 90000 00002", tier: 1, memberId: family.memberId });
    const contacts = await listEmergencyContacts(as(family, T0), circle.id);
    expect(contacts.map((c) => [c.name, c.tier, c.receivesAlerts])).toEqual([
      ["Ravi", 1, true],
      ["Mrs Reddy (neighbour)", 2, false],
    ]);
  });

  it("accepts exactly what the web form sends (tier as text, empty member)", async () => {
    const { admin, circle } = await createTeam(db());
    const { POST } = await import("@/app/api/v1/circles/[circleId]/emergency/contacts/route");
    const res = await POST(
      apiRequest("POST", `/api/v1/circles/${circle.id}/emergency/contacts`, {
        cookie: admin.cookie,
        body: { name: "Mrs Reddy", phone: "+91 90000 00009", relationship: "", tier: "2", memberId: "" },
      }),
      params({ circleId: circle.id }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).contacts[0]).toMatchObject({ tier: 2, memberId: null, relationship: null, receivesAlerts: false });
  });

  it("a linked member who leaves the circle stops receiving alerts", async () => {
    const { admin, family, circle, as } = await createTeam(db());
    await createEmergencyContact(as(admin, T0), circle.id, { name: "Ravi", phone: "+91 90000 00002", memberId: family.memberId });
    await removeMember(as(admin, T0), circle.id, family.memberId);
    expect((await listEmergencyContacts(as(admin, T0), circle.id))[0].receivesAlerts).toBe(false);
  });

  it("validates phone numbers and member links; only managers edit", async () => {
    const { admin, family, circle, as } = await createTeam(db());
    const other = await createTeam(db());
    await expect(createEmergencyContact(as(admin, T0), circle.id, { name: "X", phone: "call me" })).rejects.toMatchObject({ name: "ZodError" });
    await expect(createEmergencyContact(as(admin, T0), circle.id, { name: "X", phone: "112", memberId: other.family.memberId })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(createEmergencyContact(as(family, T0), circle.id, { name: "X", phone: "112" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("updates and deletes; contact ids from another circle are 404", async () => {
    const { admin, circle, as } = await createTeam(db());
    const [c] = await createEmergencyContact(as(admin, T0), circle.id, { name: "Dr Iyer", phone: "+91 90000 00003" });
    expect((await updateEmergencyContact(as(admin, T0), circle.id, c.id, { tier: 3 }))[0].tier).toBe(3);
    const outsider = await signUp();
    const own = await createTestCircle(outsider);
    const crossed = await deleteContactRoute(
      apiRequest("DELETE", `/api/v1/circles/${own.id}/emergency/contacts/${c.id}`, { cookie: outsider.cookie }),
      params({ circleId: own.id, contactId: c.id }),
    );
    expect(crossed.status).toBe(404);
    const ok = await deleteContactRoute(apiRequest("DELETE", `/api/v1/circles/${circle.id}/emergency/contacts/${c.id}`, { cookie: admin.cookie }), params({ circleId: circle.id, contactId: c.id }));
    expect(ok.status).toBe(204);
    expect(await listEmergencyContacts(as(admin, T0), circle.id)).toHaveLength(0);
  });
});
