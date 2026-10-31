import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { POST as tickRoute } from "@/app/api/internal/tick/route";
import { doseEvents, notifications } from "@/server/db/schema";
import { archiveCircle } from "@/server/services/circles";
import { listDoses, recordDose } from "@/server/services/doses";
import { createMedication, restockMedication } from "@/server/services/medications";
import { acknowledge, updateMyAlertSettings } from "@/server/services/notifications";
import { runTick } from "@/server/worker/tick";
import { addMember, createTestCircle } from "../helpers/circles";
import { putConsentFor } from "../helpers/consent";
import { setupTestDb } from "../helpers/db";
import { setupFakeEmail } from "../helpers/email";
import { signUp, type TestUser } from "../helpers/users";

const db = setupTestDb();
const email = setupFakeEmail();

const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
const DAY = "2026-11-14";

async function setup(med: Partial<Parameters<typeof createMedication>[2]> = {}) {
  const admin = await signUp({ name: "Priya" });
  const circle = await createTestCircle(admin);
  const people = {} as Record<"elder" | "family" | "caregiver" | "clinician" | "neighbour", TestUser>;
  for (const [key, role] of [
    ["elder", "care_recipient"],
    ["family", "family"],
    ["caregiver", "caregiver"],
    ["clinician", "clinician"],
    ["neighbour", "emergency_contact"],
  ] as const) {
    people[key] = await signUp({ name: key });
    await addMember(db(), circle.id, people[key], role);
  }
  const as = (user: TestUser, now: Date) => ({ db: db(), now, userId: user.id });
  const medication = await createMedication(as(admin, ist("2026-11-01", "07:00")), circle.id, {
    name: "Metformin",
    dosage: "1 tablet (500 mg)",
    startDate: "2026-11-01",
    asNeeded: false,
    times: ["08:00"],
    unitsPerDose: 1,
    ...med,
  });
  return { admin, circle, medication, as, ...people };
}

async function inbox(user: TestUser, kind?: string) {
  const rows = await db().select().from(notifications).where(eq(notifications.userId, user.id));
  return kind ? rows.filter((n) => n.kind === kind) : rows;
}

describe("Scenario B (alternate path): reminders, unconfirmed alerts and escalation", () => {
  it("reminds the parent and caregiver at dose time, once", async () => {
    const { elder, caregiver, family, admin, circle } = await setup();
    await runTick(db(), ist(DAY, "08:00"));
    expect((await inbox(elder, "dose_reminder"))[0]).toMatchObject({ title: "Time for your Metformin", priority: "normal" });
    expect((await inbox(caregiver, "dose_reminder"))[0].title).toBe("Amma's 08:00 medicine is due");
    expect(await inbox(family, "dose_reminder")).toHaveLength(0);
    expect(await inbox(admin, "dose_reminder")).toHaveLength(0);

    await runTick(db(), ist(DAY, "08:05"));
    expect(await inbox(elder, "dose_reminder")).toHaveLength(1);
    const [dose] = await db().select().from(doseEvents).where(eq(doseEvents.circleId, circle.id));
    expect(dose.reminderSentAt).toEqual(ist(DAY, "08:00"));
    expect(dose.status).toBe("scheduled");
  });

  it("alerts family, admin and caregiver when the dose becomes unconfirmed, without calling it missed", async () => {
    const { elder, caregiver, family, admin, clinician, neighbour } = await setup();
    await runTick(db(), ist(DAY, "08:00"));
    await runTick(db(), ist(DAY, "09:01"));

    const [alert] = await inbox(family, "dose_unconfirmed");
    expect(alert).toMatchObject({ priority: "high", title: "Amma's 08:00 medicine hasn't been confirmed" });
    expect(alert.body).toContain("doesn't mean it was missed");
    expect(alert.body).not.toMatch(/\bmissed dose\b/i);
    for (const u of [admin, caregiver]) expect(await inbox(u, "dose_unconfirmed")).toHaveLength(1);
    for (const u of [elder, clinician, neighbour]) expect(await inbox(u, "dose_unconfirmed")).toHaveLength(0);

    // The emails are deliberately free of medical detail.
    const addresses = new Set([family.email, admin.email, caregiver.email]);
    const sent = email().sent.filter((e) => addresses.has(e.to) && e.subject.includes("hasn't been confirmed"));
    expect(sent.length).toBe(3);
    expect(sent.every((e) => !e.text.includes("Metformin"))).toBe(true);
  });

  it("escalates as critical after an hour if nobody is checking, exactly once", async () => {
    const { admin, family } = await setup();
    await runTick(db(), ist(DAY, "09:01"));
    await runTick(db(), ist(DAY, "10:00"));
    expect(await inbox(admin, "dose_escalated")).toHaveLength(0);
    await runTick(db(), ist(DAY, "10:01"));
    expect((await inbox(admin, "dose_escalated"))[0]).toMatchObject({ priority: "critical" });
    expect(await inbox(family, "dose_escalated")).toHaveLength(1);
    await runTick(db(), ist(DAY, "11:00"));
    expect(await inbox(admin, "dose_escalated")).toHaveLength(1);
  });

  it("does not escalate once someone says they are checking", async () => {
    const { admin, family, as } = await setup();
    await runTick(db(), ist(DAY, "09:01"));
    const [alert] = await inbox(family, "dose_unconfirmed");
    await acknowledge(as(family, ist(DAY, "09:10")), alert.id);
    await runTick(db(), ist(DAY, "10:05"));
    expect(await inbox(admin, "dose_escalated")).toHaveLength(0);
  });

  it("sends no alert when the dose is confirmed in time", async () => {
    const { elder, family, circle, as } = await setup();
    await runTick(db(), ist(DAY, "08:00"));
    const { doses } = await listDoses(as(elder, ist(DAY, "08:10")), circle.id, { date: DAY, days: 1 });
    await recordDose(as(elder, ist(DAY, "08:10")), circle.id, doses[0].id, { status: "taken" });
    await runTick(db(), ist(DAY, "09:30"));
    await runTick(db(), ist(DAY, "11:00"));
    expect(await inbox(family, "dose_unconfirmed")).toHaveLength(0);
  });

  it("does not send stale reminders after downtime, but still raises the alert", async () => {
    const { elder, family } = await setup();
    await runTick(db(), ist(DAY, "08:45"));
    expect(await inbox(elder, "dose_reminder")).toHaveLength(0);
    await runTick(db(), ist(DAY, "09:05"));
    expect(await inbox(family, "dose_unconfirmed")).toHaveLength(1);
  });

  it("generates tomorrow's doses even if nobody opened the app", async () => {
    const { circle } = await setup();
    await runTick(db(), ist(DAY, "07:00"));
    const rows = await db().select().from(doseEvents).where(eq(doseEvents.circleId, circle.id));
    expect(rows.map((r) => r.localDate).sort()).toEqual([DAY, "2026-11-15"]);
  });
});

describe("privacy and choices", () => {
  it("family and admins get no medicine alerts when the parent doesn't share medicines", async () => {
    const { elder, family, admin, caregiver, circle } = await setup();
    await putConsentFor(elder, circle.id, { shareMedications: false, shareAppointments: true, shareHealth: true });
    await runTick(db(), ist(DAY, "09:01"));
    await runTick(db(), ist(DAY, "10:05"));
    expect(await inbox(family)).toHaveLength(0);
    expect(await inbox(admin)).toHaveLength(0);
    expect(await inbox(caregiver, "dose_unconfirmed")).toHaveLength(1);
  });

  it("members can turn off unconfirmed alerts for themselves; admins still get escalations", async () => {
    const { family, admin, circle, as } = await setup();
    await updateMyAlertSettings(as(family, ist(DAY, "07:00")), circle.id, { unconfirmedDoses: false });
    await updateMyAlertSettings(as(admin, ist(DAY, "07:00")), circle.id, { unconfirmedDoses: false });
    await runTick(db(), ist(DAY, "09:01"));
    expect(await inbox(family)).toHaveLength(0);
    expect(await inbox(admin, "dose_unconfirmed")).toHaveLength(0);
    await runTick(db(), ist(DAY, "10:05"));
    expect(await inbox(admin, "dose_escalated")).toHaveLength(1);
    expect(await inbox(family, "dose_escalated")).toHaveLength(0);
  });

  it("archived circles get no reminders or alerts", async () => {
    const { elder, family, admin, circle, as } = await setup();
    await archiveCircle(as(admin, ist(DAY, "06:00")), circle.id);
    await runTick(db(), ist(DAY, "08:00"));
    await runTick(db(), ist(DAY, "09:05"));
    expect([...(await inbox(elder)), ...(await inbox(family))]).toHaveLength(0);
  });
});

describe("refill alerts", () => {
  it("alerts once when stock reaches the threshold, and again after the next restock runs low", async () => {
    const { family, caregiver, elder, circle, medication, as } = await setup({ supplyCount: 4, refillThreshold: 3 });
    await runTick(db(), ist(DAY, "07:00"));
    expect(await inbox(family, "refill_needed")).toHaveLength(0);

    const { doses } = await listDoses(as(elder, ist(DAY, "08:00")), circle.id, { date: DAY, days: 1 });
    await recordDose(as(elder, ist(DAY, "08:00")), circle.id, doses[0].id, { status: "taken" });
    await runTick(db(), ist(DAY, "08:01"));
    expect((await inbox(family, "refill_needed"))[0]).toMatchObject({ title: "Metformin is running low", body: "3 left for Amma. Time to arrange a refill." });
    expect(await inbox(caregiver, "refill_needed")).toHaveLength(1);
    await runTick(db(), ist(DAY, "12:00"));
    expect(await inbox(family, "refill_needed")).toHaveLength(1);

    await restockMedication(as(caregiver, ist(DAY, "13:00")), circle.id, medication.id, { supplyCount: 30 });
    await runTick(db(), ist(DAY, "13:01"));
    expect(await inbox(family, "refill_needed")).toHaveLength(1);
    await restockMedication(as(caregiver, ist(DAY, "14:00")), circle.id, medication.id, { supplyCount: 2 });
    await runTick(db(), ist(DAY, "14:01"));
    expect(await inbox(family, "refill_needed")).toHaveLength(2);
  });
});

describe("robustness", () => {
  it("overlapping ticks never duplicate notifications or emails", async () => {
    const { family } = await setup();
    await Promise.all([runTick(db(), ist(DAY, "09:01")), runTick(db(), ist(DAY, "09:01")), runTick(db(), ist(DAY, "09:01"))]);
    expect(await inbox(family, "dose_unconfirmed")).toHaveLength(1);
    expect(email().sent.filter((e) => e.to === family.email)).toHaveLength(1);
  });

  it("the unconfirmed alert is tied to the dose so acknowledgements are shared", async () => {
    const { family, admin, circle } = await setup();
    await runTick(db(), ist(DAY, "09:01"));
    const [dose] = await db().select().from(doseEvents).where(and(eq(doseEvents.circleId, circle.id), eq(doseEvents.localDate, DAY)));
    const keys = [...(await inbox(family, "dose_unconfirmed")), ...(await inbox(admin, "dose_unconfirmed"))].map((n) => n.groupKey);
    expect(new Set(keys)).toEqual(new Set([`dose:${dose.id}`]));
  });
});

describe("POST /api/internal/tick", () => {
  const original = process.env.CRON_SECRET;
  afterEach(() => {
    process.env.CRON_SECRET = original;
  });
  const call = (auth?: string) =>
    tickRoute(new Request("http://localhost/api/internal/tick", { method: "POST", headers: auth ? { authorization: auth } : {} }));

  it("is disabled without a configured secret", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer anything")).status).toBe(404);
  });

  it("requires the exact secret and then runs a tick", async () => {
    process.env.CRON_SECRET = "a-long-random-test-secret";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    const res = await call("Bearer a-long-random-test-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("circles");
  });
});
