import { describe, expect, it } from "vitest";
import { GET as audit } from "@/app/api/v1/circles/[circleId]/audit/route";
import { PUT as putConsent } from "@/app/api/v1/circles/[circleId]/consent/route";
import { POST as archive } from "@/app/api/v1/circles/[circleId]/archive/route";
import { POST as restock } from "@/app/api/v1/circles/[circleId]/medications/[medicationId]/restock/route";
import { GET as getMed, PATCH as patchMed } from "@/app/api/v1/circles/[circleId]/medications/[medicationId]/route";
import { POST as stop } from "@/app/api/v1/circles/[circleId]/medications/[medicationId]/stop/route";
import { GET as listMeds, POST as createMed } from "@/app/api/v1/circles/[circleId]/medications/route";
import { addMember, createTestCircle } from "../helpers/circles";
import { setupTestDb } from "../helpers/db";
import { apiRequest, params } from "../helpers/http";
import { createTestMedication, METFORMIN } from "../helpers/medications";
import { signUp, type TestUser } from "../helpers/users";

const db = setupTestDb();

async function circleWithTeam() {
  const admin = await signUp({ name: "Priya" });
  const circle = await createTestCircle(admin);
  const roles = ["family", "caregiver", "clinician", "emergency_contact", "care_recipient"] as const;
  const team = {} as Record<(typeof roles)[number], TestUser>;
  for (const role of roles) {
    team[role] = await signUp({ name: role });
    await addMember(db(), circle.id, team[role], role);
  }
  return { admin, circle, ...team };
}

const list = (user: TestUser, circleId: string, query = "") =>
  listMeds(apiRequest("GET", `/api/v1/circles/${circleId}/medications${query}`, { cookie: user.cookie }), params({ circleId }));
const create = (user: TestUser, circleId: string, body: unknown) =>
  createMed(apiRequest("POST", `/api/v1/circles/${circleId}/medications`, { cookie: user.cookie, body }), params({ circleId }));
const patch = (user: TestUser, circleId: string, medicationId: string, body: unknown) =>
  patchMed(
    apiRequest("PATCH", `/api/v1/circles/${circleId}/medications/${medicationId}`, { cookie: user.cookie, body }),
    params({ circleId, medicationId }),
  );

describe("creating medicines", () => {
  it("stores the prescription as written, with times sorted", async () => {
    const { admin, circle } = await circleWithTeam();
    const res = await create(admin, circle.id, { ...METFORMIN, times: ["20:00", "08:00"], supplyCount: 60, refillThreshold: 10 });
    expect(res.status).toBe(201);
    const { medication } = await res.json();
    expect(medication).toMatchObject({
      name: "Metformin",
      dosage: "1 tablet (500 mg)",
      instructions: "Take with food",
      prescriber: "Dr. Iyer",
      times: ["08:00", "20:00"],
      daysOfWeek: null,
      asNeeded: false,
      supplyCount: 60,
      needsRefill: false,
      status: "active",
      version: 1,
    });
  });

  it("defaults the start date to today in the recipient's zone", async () => {
    const { admin, circle } = await circleWithTeam();
    const res = await create(admin, circle.id, { name: "Vitamin D", dosage: "1 capsule", times: ["09:00"] });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    expect((await res.json()).medication.startDate).toBe(today);
  });

  it("supports as-needed medicines without times", async () => {
    const { admin, circle } = await circleWithTeam();
    const res = await create(admin, circle.id, { name: "Paracetamol", dosage: "1 tablet", asNeeded: true, times: ["09:00"] });
    expect((await res.json()).medication).toMatchObject({ asNeeded: true, times: [] });
  });

  it("validates times, dates and schedule completeness", async () => {
    const { admin, circle } = await circleWithTeam();
    const res = await create(admin, circle.id, {
      name: "",
      dosage: "1",
      times: ["8am"],
      startDate: "2026-11-10",
      endDate: "2026-11-01",
      daysOfWeek: [0],
    });
    expect(res.status).toBe(422);
    expect(Object.keys((await res.json()).error.details).sort()).toEqual(["daysOfWeek.0", "endDate", "name", "times.0"]);
    const noTimes = await create(admin, circle.id, { name: "X", dosage: "1", times: [] });
    expect((await noTimes.json()).error.details.times).toBeDefined();
  });
});

describe("who can see and manage medicines", () => {
  it("follows the permission matrix", async () => {
    const team = await circleWithTeam();
    const body = { name: "Amlodipine", dosage: "5 mg", times: ["09:00"] };
    expect((await create(team.clinician, team.circle.id, body)).status).toBe(201);
    expect((await create(team.care_recipient, team.circle.id, body)).status).toBe(201);
    expect((await create(team.family, team.circle.id, body)).status).toBe(403);
    expect((await create(team.caregiver, team.circle.id, body)).status).toBe(403);
    expect((await create(team.emergency_contact, team.circle.id, body)).status).toBe(403);

    for (const viewer of [team.admin, team.family, team.caregiver, team.clinician, team.care_recipient]) {
      expect((await list(viewer, team.circle.id)).status).toBe(200);
    }
    expect((await list(team.emergency_contact, team.circle.id)).status).toBe(403);
  });

  it("hides medicines from family when the recipient stops sharing them, but not from the caregiver", async () => {
    const team = await circleWithTeam();
    await createTestMedication(team.admin, team.circle.id);
    await putConsent(
      apiRequest("PUT", `/api/v1/circles/${team.circle.id}/consent`, {
        cookie: team.care_recipient.cookie,
        body: { shareMedications: false, shareAppointments: true, shareHealth: true },
      }),
      params({ circleId: team.circle.id }),
    );
    expect((await list(team.family, team.circle.id)).status).toBe(403);
    expect((await list(team.admin, team.circle.id)).status).toBe(403);
    expect((await list(team.caregiver, team.circle.id)).status).toBe(200);
  });

  it("is isolated per circle (404 for outsiders, including by medicine id)", async () => {
    const team = await circleWithTeam();
    const med = await createTestMedication(team.admin, team.circle.id);
    const outsider = await signUp();
    const otherCircle = await createTestCircle(outsider);

    expect((await list(outsider, team.circle.id)).status).toBe(404);
    expect((await patch(outsider, team.circle.id, med.id, { version: 1, name: "x" })).status).toBe(404);
    // Using their own circle id with someone else's medicine id must not work either.
    const crossed = await getMed(
      apiRequest("GET", `/api/v1/circles/${otherCircle.id}/medications/${med.id}`, { cookie: outsider.cookie }),
      params({ circleId: otherCircle.id, medicationId: med.id }),
    );
    expect(crossed.status).toBe(404);
  });
});

describe("changing and stopping medicines", () => {
  it("updates with optimistic concurrency and records the change", async () => {
    const { admin, circle } = await circleWithTeam();
    const med = await createTestMedication(admin, circle.id);
    const ok = await patch(admin, circle.id, med.id, { version: 1, dosage: "2 tablets (1000 mg)", times: ["09:00"] });
    expect(ok.status).toBe(200);
    expect((await ok.json()).medication).toMatchObject({ dosage: "2 tablets (1000 mg)", times: ["09:00"], version: 2 });
    expect((await patch(admin, circle.id, med.id, { version: 1, dosage: "stale" })).status).toBe(409);

    const { events } = await (await audit(apiRequest("GET", `/api/v1/circles/${circle.id}/audit`, { cookie: admin.cookie }), params({ circleId: circle.id }))).json();
    const update = events.find((e: { action: string }) => e.action === "medication.updated");
    expect(update.metadata.before).toMatchObject({ dosage: "1 tablet (500 mg)", times: ["08:00", "20:00"] });
  });

  it("stopping keeps the medicine in history and blocks further edits", async () => {
    const { admin, circle } = await circleWithTeam();
    const med = await createTestMedication(admin, circle.id);
    const res = await stop(
      apiRequest("POST", `/api/v1/circles/${circle.id}/medications/${med.id}/stop`, { cookie: admin.cookie, body: { reason: "Doctor changed prescription" } }),
      params({ circleId: circle.id, medicationId: med.id }),
    );
    expect((await res.json()).medication).toMatchObject({ status: "stopped", stopReason: "Doctor changed prescription" });
    expect((await (await list(admin, circle.id)).json()).medications).toHaveLength(0);
    expect((await (await list(admin, circle.id, "?includeStopped=true")).json()).medications).toHaveLength(1);
    expect((await patch(admin, circle.id, med.id, { version: 2, name: "x" })).status).toBe(409);
  });

  it("lets anyone who records doses update the stock, and flags low supply", async () => {
    const team = await circleWithTeam();
    const med = await createTestMedication(team.admin, team.circle.id, { supplyCount: 30, refillThreshold: 5 });
    const res = await restock(
      apiRequest("POST", `/api/v1/circles/${team.circle.id}/medications/${med.id}/restock`, { cookie: team.caregiver.cookie, body: { supplyCount: 4 } }),
      params({ circleId: team.circle.id, medicationId: med.id }),
    );
    expect((await res.json()).medication).toMatchObject({ supplyCount: 4, needsRefill: true });
    const denied = await restock(
      apiRequest("POST", `/api/v1/circles/${team.circle.id}/medications/${med.id}/restock`, { cookie: team.clinician.cookie, body: { supplyCount: 4 } }),
      params({ circleId: team.circle.id, medicationId: med.id }),
    );
    expect(denied.status).toBe(403);
  });

  it("archived circles are read-only", async () => {
    const { admin, circle } = await circleWithTeam();
    await archive(apiRequest("POST", `/api/v1/circles/${circle.id}/archive`, { cookie: admin.cookie }), params({ circleId: circle.id }));
    expect((await create(admin, circle.id, METFORMIN)).status).toBe(409);
    expect((await list(admin, circle.id)).status).toBe(200);
  });
});
