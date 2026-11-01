import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as listCheckinsRoute } from "@/app/api/v1/circles/[circleId]/checkins/route";
import { DELETE as removeRoute } from "@/app/api/v1/circles/[circleId]/measurements/[measurementId]/route";
import { GET as listRoute, POST as recordRoute } from "@/app/api/v1/circles/[circleId]/measurements/route";
import { auditEvents, measurements } from "@/server/db/schema";
import { listCheckins, listMeasurements, recordMeasurement } from "@/server/services/measurements";
import { postUpdate } from "@/server/services/updates";
import { createTeam } from "../helpers/circles";
import { putConsentFor } from "../helpers/consent";
import { setupTestDb } from "../helpers/db";
import { apiRequest, params } from "../helpers/http";
import type { TestUser } from "../helpers/users";

const db = setupTestDb();

const record = (user: TestUser, circleId: string, body: unknown) =>
  recordRoute(apiRequest("POST", `/api/v1/circles/${circleId}/measurements`, { cookie: user.cookie, body }), params({ circleId }));
const list = async (user: TestUser, circleId: string, query = "") =>
  listRoute(apiRequest("GET", `/api/v1/circles/${circleId}/measurements${query}`, { cookie: user.cookie }), params({ circleId }));

describe("recording health readings", () => {
  it("records readings in the unit entered, marks whether the parent or someone else entered them, and lists them", async () => {
    const team = await createTeam(db());
    expect((await record(team.elder, team.circle.id, { kind: "blood_pressure", unit: "mmHg", value: 132, value2: 84 })).status).toBe(201);
    expect((await record(team.caregiver, team.circle.id, { kind: "temperature", unit: "°F", value: "101.3", note: "After lunch" })).status).toBe(201);
    expect((await record(team.family, team.circle.id, { kind: "blood_sugar", unit: "mmol/L", value: 7.2, context: "fasting" })).status).toBe(201);

    const { measurements: rows } = await (await list(team.admin, team.circle.id)).json();
    expect(rows).toHaveLength(3);
    const bp = rows.find((r: { kind: string }) => r.kind === "blood_pressure");
    expect(bp).toMatchObject({ value: 132, value2: 84, unit: "mmHg", source: "self", recordedBy: { name: "Amma" } });
    const temp = rows.find((r: { kind: string }) => r.kind === "temperature");
    expect(temp).toMatchObject({ unit: "°F", source: "proxy", note: "After lunch" });
    expect(temp.value).toBeCloseTo(38.5, 1); // stored in °C
    const sugar = rows.find((r: { kind: string }) => r.kind === "blood_sugar");
    expect(sugar).toMatchObject({ context: "fasting", unit: "mmol/L" });
    expect((await (await list(team.admin, team.circle.id, "?kind=temperature")).json()).measurements).toHaveLength(1);
  });

  it("rejects typing mistakes with a message per field, and readings in the future", async () => {
    const team = await createTeam(db());
    const bad = await record(team.caregiver, team.circle.id, { kind: "blood_pressure", unit: "mmHg", value: 1320, value2: 84 });
    expect(bad.status).toBe(422);
    expect(Object.keys((await bad.json()).error.details)).toEqual(["value"]);
    const swapped = await record(team.caregiver, team.circle.id, { kind: "blood_pressure", unit: "mmHg", value: 80, value2: 130 });
    expect((await swapped.json()).error.details).toHaveProperty("value2");
    const wrongUnit = await record(team.caregiver, team.circle.id, { kind: "weight", unit: "°C", value: 60 });
    expect((await wrongUnit.json()).error.details).toHaveProperty("unit");
    const future = await record(team.caregiver, team.circle.id, { kind: "pulse", unit: "bpm", value: 72, measuredAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect((await future.json()).error.details).toHaveProperty("measuredAt");
    const contextOnWeight = await record(team.caregiver, team.circle.id, { kind: "weight", unit: "kg", value: 60, context: "fasting" });
    expect((await contextOnWeight.json()).error.details).toHaveProperty("context");
    expect(await db().select().from(measurements).where(eq(measurements.circleId, team.circle.id))).toEqual([]);
  });

  it("follows the parent's choice not to share health details, for seeing and for recording", async () => {
    const team = await createTeam(db());
    await record(team.caregiver, team.circle.id, { kind: "pulse", unit: "bpm", value: 72 });
    await putConsentFor(team.elder, team.circle.id, { shareMedications: true, shareAppointments: true, shareHealth: false });
    expect((await list(team.family, team.circle.id)).status).toBe(403);
    expect((await record(team.admin, team.circle.id, { kind: "pulse", unit: "bpm", value: 70 })).status).toBe(403);
    expect((await list(team.caregiver, team.circle.id)).status).toBe(200);
    expect((await list(team.neighbour, team.circle.id)).status).toBe(403);
  });

  it("is 404 for outsiders, 401 when signed out, and never shows another family's readings", async () => {
    const team = await createTeam(db());
    const other = await createTeam(db());
    await record(other.caregiver, other.circle.id, { kind: "weight", unit: "kg", value: 61.5 });
    expect((await list(other.admin, team.circle.id)).status).toBe(404);
    expect((await record(other.admin, team.circle.id, { kind: "pulse", unit: "bpm", value: 70 })).status).toBe(404);
    expect((await listRoute(apiRequest("GET", `/api/v1/circles/${team.circle.id}/measurements`), params({ circleId: team.circle.id }))).status).toBe(401);
    expect((await (await list(team.admin, team.circle.id)).json()).measurements).toEqual([]);
  });

  it("lets the person who recorded a reading, or an admin, remove it, and logs the removal", async () => {
    const team = await createTeam(db());
    const ctx = team.as(team.caregiver, new Date());
    const { id } = await recordMeasurement(ctx, team.circle.id, { kind: "pulse", unit: "bpm", value: 72 });
    const { id: second } = await recordMeasurement(ctx, team.circle.id, { kind: "pulse", unit: "bpm", value: 74 });
    const remove = (user: TestUser, measurementId: string) =>
      removeRoute(apiRequest("DELETE", `/api/v1/circles/${team.circle.id}/measurements/${measurementId}`, { cookie: user.cookie }), params({ circleId: team.circle.id, measurementId }));
    expect((await remove(team.family, id)).status).toBe(403);
    expect((await remove(team.caregiver, id)).status).toBe(204);
    expect((await remove(team.caregiver, id)).status).toBe(404); // already gone
    expect((await remove(team.admin, second)).status).toBe(204);
    expect(await listMeasurements(team.as(team.admin, new Date()), team.circle.id, { days: 90 })).toEqual([]);
    const audit = await db().select().from(auditEvents).where(eq(auditEvents.action, "measurement.removed"));
    expect(audit.filter((a) => a.circleId === team.circle.id)).toHaveLength(2);
  });
});

describe("daily check-ins", () => {
  it("keeps the parent's last answer for each day, and only the parent can give one", async () => {
    const team = await createTeam(db());
    const day = (iso: string) => team.as(team.elder, new Date(iso));
    await postUpdate(day("2026-11-12T04:00:00Z"), team.circle.id, { body: "I'm fine today.", checkin: "fine" });
    await postUpdate(day("2026-11-13T04:00:00Z"), team.circle.id, { body: "I'm not feeling well.", checkin: "unwell", category: "health", important: true });
    await postUpdate(day("2026-11-13T12:00:00Z"), team.circle.id, { body: "I'm fine today.", checkin: "fine" });
    const checkins = await listCheckins(team.as(team.family, new Date("2026-11-14T04:00:00Z")), team.circle.id, 14);
    expect(checkins.map((c) => [c.date, c.feeling])).toEqual([
      ["2026-11-12", "fine"],
      ["2026-11-13", "fine"],
    ]);
    await expect(postUpdate(team.as(team.family, new Date()), team.circle.id, { body: "She's fine", checkin: "fine" })).rejects.toThrow(/Only the person receiving care/);
    const res = await listCheckinsRoute(apiRequest("GET", `/api/v1/circles/${team.circle.id}/checkins`, { cookie: team.family.cookie }), params({ circleId: team.circle.id }));
    expect(res.status).toBe(200);
  });
});
