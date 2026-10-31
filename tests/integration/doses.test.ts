import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as auditRoute } from "@/app/api/v1/circles/[circleId]/audit/route";
import { POST as recordRoute } from "@/app/api/v1/circles/[circleId]/doses/[doseId]/record/route";
import { GET as listDosesRoute } from "@/app/api/v1/circles/[circleId]/doses/route";
import { doseEvents, medications } from "@/server/db/schema";
import { archiveCircle, updateCircle } from "@/server/services/circles";
import { getDoseHistory, listDoses, recordAsNeededDose, recordDose } from "@/server/services/doses";
import { createMedication, stopMedication, updateMedication } from "@/server/services/medications";
import { putConsentFor } from "../helpers/consent";
import { addMember, createTestCircle } from "../helpers/circles";
import { setupTestDb } from "../helpers/db";
import { apiRequest, params } from "../helpers/http";
import { signUp, type TestUser } from "../helpers/users";

const db = setupTestDb();

/** Instant for a wall-clock time in India (UTC+05:30) on a given day. */
const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
const DAY = "2026-11-14";

async function setup(medOverrides: Partial<Parameters<typeof createMedication>[2]> = {}) {
  const admin = await signUp({ name: "Priya" });
  const circle = await createTestCircle(admin);
  const people = {} as Record<"elder" | "family" | "caregiver" | "clinician", TestUser>;
  for (const [key, role] of [
    ["elder", "care_recipient"],
    ["family", "family"],
    ["caregiver", "caregiver"],
    ["clinician", "clinician"],
  ] as const) {
    people[key] = await signUp({ name: key });
    await addMember(db(), circle.id, people[key], role);
  }
  const as = (user: TestUser, now: Date) => ({ db: db(), now, userId: user.id });
  const med = await createMedication(as(admin, ist("2026-11-01", "07:00")), circle.id, {
    name: "Metformin",
    dosage: "1 tablet (500 mg)",
    startDate: "2026-11-01",
    endDate: null,
    asNeeded: false,
    times: ["08:00", "20:00"],
    unitsPerDose: 1,
    supplyCount: 10,
    refillThreshold: 3,
    ...medOverrides,
  });
  return { admin, circle, med, as, ...people };
}

async function supplyOf(medicationId: string) {
  const [row] = await db().select({ s: medications.supplyCount }).from(medications).where(eq(medications.id, medicationId));
  return row.s;
}

describe("Scenario B: medication confirmation", () => {
  it("generates the day's doses in the recipient's zone, idempotently", async () => {
    const { admin, circle, as } = await setup();
    const first = await listDoses(as(admin, ist(DAY, "07:00")), circle.id, { date: DAY, days: 1 });
    expect(first.timeZone).toBe("Asia/Kolkata");
    expect(first.doses.map((d) => [d.localTime, d.status])).toEqual([
      ["08:00", "scheduled"],
      ["20:00", "scheduled"],
    ]);
    expect(first.doses[0].scheduledFor?.toISOString()).toBe("2026-11-14T02:30:00.000Z");

    const again = await listDoses(as(admin, ist(DAY, "07:05")), circle.id, { date: DAY, days: 1 });
    expect(again.doses.map((d) => d.id)).toEqual(first.doses.map((d) => d.id));
  });

  it("the parent confirms; it is recorded as self-reported and stock goes down", async () => {
    const { elder, circle, med, as } = await setup();
    const { doses } = await listDoses(as(elder, ist(DAY, "07:55")), circle.id, { date: DAY, days: 1 });
    const dose = await recordDose(as(elder, ist(DAY, "08:05")), circle.id, doses[0].id, { status: "taken" });
    expect(dose).toMatchObject({ status: "taken", source: "self", recordedBy: { id: elder.id } });
    expect(dose.occurredAt?.toISOString()).toBe(ist(DAY, "08:05").toISOString());
    expect(await supplyOf(med.id)).toBe(9);
  });

  it("an unanswered dose becomes 'unconfirmed' after the grace period — never 'missed' or 'taken'", async () => {
    const { admin, circle, as } = await setup();
    const at = (time: string) => listDoses(as(admin, ist(DAY, time)), circle.id, { date: DAY, days: 1 });
    expect((await at("09:00")).doses[0].status).toBe("scheduled");
    const later = await at("09:01");
    expect(later.doses[0].status).toBe("unconfirmed");
    expect(later.doses[1].status).toBe("scheduled");
  });

  it("a late entry by the caregiver keeps both the real time and the recording time", async () => {
    const { caregiver, circle, as } = await setup();
    const { doses } = await listDoses(as(caregiver, ist(DAY, "11:00")), circle.id, { date: DAY, days: 1 });
    expect(doses[0].status).toBe("unconfirmed");
    const dose = await recordDose(as(caregiver, ist(DAY, "11:00")), circle.id, doses[0].id, {
      status: "administered",
      occurredAt: ist(DAY, "08:10").toISOString(),
      note: "Given with breakfast",
    });
    expect(dose).toMatchObject({ status: "administered", source: "caregiver", note: "Given with breakfast" });
    expect(dose.occurredAt?.toISOString()).toBe(ist(DAY, "08:10").toISOString());
    expect(dose.recordedAt?.toISOString()).toBe(ist(DAY, "11:00").toISOString());
  });

  it("family reporting on the parent's behalf is marked as a proxy record", async () => {
    const { family, circle, as } = await setup();
    const { doses } = await listDoses(as(family, ist(DAY, "08:30")), circle.id, { date: DAY, days: 1 });
    const dose = await recordDose(as(family, ist(DAY, "08:30")), circle.id, doses[0].id, { status: "taken" });
    expect(dose?.source).toBe("proxy");
  });

  it("records refusals and skips with reasons, without using stock", async () => {
    const { caregiver, circle, med, as } = await setup();
    const { doses } = await listDoses(as(caregiver, ist(DAY, "08:30")), circle.id, { date: DAY, days: 1 });
    const dose = await recordDose(as(caregiver, ist(DAY, "08:30")), circle.id, doses[0].id, {
      status: "refused",
      reason: "Felt nauseous",
      sideEffects: "Nausea since last night",
    });
    expect(dose).toMatchObject({ status: "refused", reason: "Felt nauseous", sideEffects: "Nausea since last night", occurredAt: null });
    expect(await supplyOf(med.id)).toBe(10);
  });
});

describe("recording rules", () => {
  it("the parent cannot record 'administered'; clinicians cannot record doses", async () => {
    const { elder, clinician, circle, as } = await setup();
    const { doses } = await listDoses(as(elder, ist(DAY, "08:00")), circle.id, { date: DAY, days: 1 });
    await expect(recordDose(as(elder, ist(DAY, "08:00")), circle.id, doses[0].id, { status: "administered" })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(recordDose(as(clinician, ist(DAY, "08:00")), circle.id, doses[0].id, { status: "taken" })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("refuses to record doses more than 2 hours early, or with a future 'occurred at'", async () => {
    const { elder, circle, as } = await setup();
    const { doses } = await listDoses(as(elder, ist(DAY, "07:00")), circle.id, { date: DAY, days: 1 });
    await expect(recordDose(as(elder, ist(DAY, "07:00")), circle.id, doses[1].id, { status: "taken" })).rejects.toMatchObject({
      code: "conflict",
    });
    expect((await recordDose(as(elder, ist(DAY, "06:30")), circle.id, doses[0].id, { status: "taken" }))?.status).toBe("taken");
    await expect(
      recordDose(as(elder, ist(DAY, "19:00")), circle.id, doses[1].id, { status: "taken", occurredAt: ist(DAY, "21:00").toISOString() }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("corrections are kept in history, audited, and give stock back", async () => {
    const { elder, family, admin, circle, med, as } = await setup();
    const { doses } = await listDoses(as(elder, ist(DAY, "08:00")), circle.id, { date: DAY, days: 1 });
    await recordDose(as(elder, ist(DAY, "08:00")), circle.id, doses[0].id, { status: "taken" });
    expect(await supplyOf(med.id)).toBe(9);
    await recordDose(as(family, ist(DAY, "10:00")), circle.id, doses[0].id, { status: "skipped", reason: "Pill found on the floor" });
    expect(await supplyOf(med.id)).toBe(10);

    const history = await getDoseHistory(as(admin, ist(DAY, "10:05")), circle.id, doses[0].id);
    expect(history.map((h) => [h.previousStatus, h.status, h.isCorrection, h.recordedBy?.id])).toEqual([
      ["scheduled", "taken", false, elder.id],
      ["taken", "skipped", true, family.id],
    ]);

    const { events } = await (await auditRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/audit`, { cookie: admin.cookie }), params({ circleId: circle.id }))).json();
    expect(events[0]).toMatchObject({ action: "dose.corrected", metadata: { from: "taken", to: "skipped" } });
  });

  it("corrections are refused after 72 hours", async () => {
    const { elder, circle, as } = await setup();
    const { doses } = await listDoses(as(elder, ist(DAY, "08:00")), circle.id, { date: DAY, days: 1 });
    await recordDose(as(elder, ist(DAY, "08:00")), circle.id, doses[0].id, { status: "taken" });
    await expect(
      recordDose(as(elder, ist("2026-11-17", "08:01")), circle.id, doses[0].id, { status: "skipped" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("stock never goes below zero", async () => {
    const { elder, circle, med, as } = await setup({ supplyCount: 0 });
    const { doses } = await listDoses(as(elder, ist(DAY, "08:00")), circle.id, { date: DAY, days: 1 });
    await recordDose(as(elder, ist(DAY, "08:00")), circle.id, doses[0].id, { status: "taken" });
    expect(await supplyOf(med.id)).toBe(0);
  });
});

describe("schedule changes keep history intact", () => {
  it("changing times regenerates future unanswered doses but keeps recorded ones", async () => {
    const { admin, elder, circle, med, as } = await setup();
    const morning = (await listDoses(as(elder, ist(DAY, "08:00")), circle.id, { date: DAY, days: 1 })).doses[0];
    await recordDose(as(elder, ist(DAY, "08:00")), circle.id, morning.id, { status: "taken" });

    await updateMedication(as(admin, ist(DAY, "12:00")), circle.id, med.id, { version: 1, times: ["08:00", "21:00"] });
    const after = await listDoses(as(admin, ist(DAY, "12:00")), circle.id, { date: DAY, days: 1 });
    expect(after.doses.map((d) => [d.localTime, d.status])).toEqual([
      ["08:00", "taken"],
      ["21:00", "scheduled"],
    ]);
    expect(after.doses[0].id).toBe(morning.id);
  });

  it("stopping removes the rest of today's doses and they do not come back", async () => {
    const { admin, circle, med, as } = await setup();
    await listDoses(as(admin, ist(DAY, "07:00")), circle.id, { date: DAY, days: 2 });
    await stopMedication(as(admin, ist(DAY, "12:00")), circle.id, med.id, { reason: "Stopped by doctor" });
    const after = await listDoses(as(admin, ist(DAY, "12:05")), circle.id, { date: DAY, days: 2 });
    expect(after.doses.map((d) => d.localTime)).toEqual(["08:00"]);
    expect(after.doses[0].status).toBe("unconfirmed");
  });

  it("when the parent moves time zone, upcoming doses follow their new local clock", async () => {
    const { admin, circle, as } = await setup();
    await listDoses(as(admin, ist(DAY, "07:00")), circle.id, { date: DAY, days: 2 });
    await updateCircle(as(admin, ist(DAY, "12:00")), circle.id, { version: 1, timeZone: "Europe/London", country: "GB" });
    const next = await listDoses(as(admin, ist(DAY, "12:00")), circle.id, { date: "2026-11-15", days: 1 });
    expect(next.timeZone).toBe("Europe/London");
    expect(next.doses.map((d) => d.scheduledFor?.toISOString())).toEqual(["2026-11-15T08:00:00.000Z", "2026-11-15T20:00:00.000Z"]);
  });

  it("weekday schedules and multi-day ranges", async () => {
    const { admin, circle, as } = await setup({ times: ["09:00"], daysOfWeek: [1, 4] });
    // 2026-11-16 is a Monday.
    const week = await listDoses(as(admin, ist("2026-11-16", "07:00")), circle.id, { date: "2026-11-16", days: 7 });
    expect(week.doses.map((d) => d.localDate)).toEqual(["2026-11-16", "2026-11-19"]);
  });
});

describe("as-needed medicines", () => {
  it("records ad-hoc doses that appear on that day's list", async () => {
    const { admin, caregiver, circle, as } = await setup();
    const prn = await createMedication(as(admin, ist(DAY, "07:00")), circle.id, {
      name: "Paracetamol",
      dosage: "1 tablet",
      asNeeded: true,
      times: [],
      unitsPerDose: 1,
      supplyCount: 20,
    });
    const dose = await recordAsNeededDose(as(caregiver, ist(DAY, "15:00")), circle.id, prn.id, { status: "administered", note: "Headache" });
    expect(dose).toMatchObject({ status: "administered", scheduledFor: null, note: "Headache" });
    const { doses } = await listDoses(as(admin, ist(DAY, "16:00")), circle.id, { date: DAY, days: 1 });
    expect(doses.map((d) => d.medication.name)).toContain("Paracetamol");
    expect(await supplyOf(prn.id)).toBe(19);
  });

  it("refuses ad-hoc doses for scheduled medicines", async () => {
    const { caregiver, circle, med, as } = await setup();
    await expect(recordAsNeededDose(as(caregiver, ist(DAY, "15:00")), circle.id, med.id, { status: "administered" })).rejects.toMatchObject({
      code: "conflict",
    });
  });
});

describe("access through the API", () => {
  it("outsiders get 404, including with another circle's dose id", async () => {
    const { admin, circle, as } = await setup();
    const { doses } = await listDoses(as(admin, ist(DAY, "07:00")), circle.id, { date: DAY, days: 1 });
    const outsider = await signUp();
    const own = await createTestCircle(outsider);
    expect((await listDosesRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/doses`, { cookie: outsider.cookie }), params({ circleId: circle.id }))).status).toBe(404);
    const crossed = await recordRoute(
      apiRequest("POST", `/api/v1/circles/${own.id}/doses/${doses[0].id}/record`, { cookie: outsider.cookie, body: { status: "taken" } }),
      params({ circleId: own.id, doseId: doses[0].id }),
    );
    expect(crossed.status).toBe(404);
    const [stillScheduled] = await db().select({ status: doseEvents.status }).from(doseEvents).where(eq(doseEvents.id, doses[0].id));
    expect(["scheduled", "unconfirmed"]).toContain(stillScheduled.status);
  });

  it("validates the query and body", async () => {
    const { admin, circle } = await setup();
    const bad = await listDosesRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/doses?date=14-11-2026&days=30`, { cookie: admin.cookie }), params({ circleId: circle.id }));
    expect(bad.status).toBe(422);
    expect(Object.keys((await bad.json()).error.details).sort()).toEqual(["date", "days"]);
    const badBody = await recordRoute(
      apiRequest("POST", `/api/v1/circles/${circle.id}/doses/00000000-0000-4000-8000-000000000000/record`, { cookie: admin.cookie, body: { status: "missed" } }),
      params({ circleId: circle.id, doseId: "00000000-0000-4000-8000-000000000000" }),
    );
    expect(badBody.status).toBe(422);
  });

  it("family cannot see or record doses when the parent stops sharing medicines", async () => {
    const { elder, family, caregiver, circle, as } = await setup();
    await putConsentFor(elder, circle.id, { shareMedications: false, shareAppointments: true, shareHealth: true });
    await expect(listDoses(as(family, ist(DAY, "08:00")), circle.id, { date: DAY, days: 1 })).rejects.toMatchObject({ code: "forbidden" });
    const { doses } = await listDoses(as(caregiver, ist(DAY, "08:00")), circle.id, { date: DAY, days: 1 });
    await expect(recordDose(as(family, ist(DAY, "08:00")), circle.id, doses[0].id, { status: "taken" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("archived circles can be read but not recorded in", async () => {
    const { admin, circle, as } = await setup();
    const { doses } = await listDoses(as(admin, ist(DAY, "08:00")), circle.id, { date: DAY, days: 1 });
    await archiveCircle(as(admin, ist(DAY, "08:00")), circle.id);
    expect((await listDoses(as(admin, ist(DAY, "08:30")), circle.id, { date: DAY, days: 1 })).doses).toHaveLength(2);
    await expect(recordDose(as(admin, ist(DAY, "08:30")), circle.id, doses[0].id, { status: "taken" })).rejects.toMatchObject({ code: "conflict" });
  });
});
