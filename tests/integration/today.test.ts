import { describe, expect, it } from "vitest";
import { GET as circleTodayRoute } from "@/app/api/v1/circles/[circleId]/today/route";
import { GET as myTodayRoute } from "@/app/api/v1/me/today/route";
import { createAppointment, assignHelper } from "@/server/services/appointments";
import { raiseAssistance } from "@/server/services/assistance";
import { listDoses, recordDose } from "@/server/services/doses";
import { createMedication } from "@/server/services/medications";
import { createTask } from "@/server/services/tasks";
import { getCircleToday, getMyToday } from "@/server/services/today";
import { postUpdate } from "@/server/services/updates";
import { createVisit } from "@/server/services/visits";
import { createTeam, createTestCircle } from "../helpers/circles";
import { putConsentFor } from "../helpers/consent";
import { setupTestDb } from "../helpers/db";
import { setupFakeEmail } from "../helpers/email";
import { apiRequest, params } from "../helpers/http";
import { signUp } from "../helpers/users";

const db = setupTestDb();
setupFakeEmail();
const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
const DAY = "2026-11-14";
const NOON = ist(DAY, "12:00");

async function busyCircle() {
  const team = await createTeam(db());
  const { admin, elder, caregiver, circle, as } = team;
  const created = ist(DAY, "06:00");
  await createMedication(as(admin, created), circle.id, { name: "Metformin", dosage: "500 mg", startDate: DAY, asNeeded: false, times: ["08:00", "11:00", "20:00"], unitsPerDose: 1, supplyCount: 3, refillThreshold: 5 });
  const { doses } = await listDoses(as(elder, ist(DAY, "08:05")), circle.id, { date: DAY, days: 1 });
  await recordDose(as(elder, ist(DAY, "08:05")), circle.id, doses[0].id, { status: "taken" });
  await createAppointment(as(admin, created), circle.id, { title: "Cardiology", kind: "in_person", transportNeeded: true, startsAt: ist("2026-11-15", "10:00").toISOString() });
  await createTask(as(admin, created), circle.id, { title: "Buy BP medicine", dueAt: ist(DAY, "09:00").toISOString() });
  await createVisit(as(caregiver, created), circle.id, { plannedStart: ist(DAY, "10:00").toISOString() });
  return team;
}

describe("circle 'today' summary", () => {
  it("lists what needs attention, and counts doses by status in the recipient's day", async () => {
    const { admin, circle, as } = await busyCircle();
    // At 12:00 the 11:00 dose is still within its 60-minute grace period ("due");
    // at 12:30 it has become "unconfirmed".
    expect((await getCircleToday(as(admin, NOON), circle.id)).medicines!.counts).toMatchObject({ due: 1, unconfirmed: 0 });
    const today = await getCircleToday(as(admin, ist(DAY, "12:30")), circle.id);
    expect(today.circle).toMatchObject({ recipientName: "Amma", timeZone: "Asia/Kolkata", localDate: DAY, myRole: "admin" });
    expect(today.medicines!.counts).toMatchObject({ taken: 1, due: 0, unconfirmed: 1, upcoming: 1 });
    expect(today.medicines!.lowStock).toEqual([expect.objectContaining({ name: "Metformin", supplyCount: 2 })]);
    expect(today.attention.map((a) => a.kind).sort()).toEqual(
      ["dose_unconfirmed", "low_stock", "needs_driver", "overdue_task", "unassigned_task", "visit_not_checked_in"].sort(),
    );
    expect(today.tasks).toMatchObject({ unassignedCount: 1, overdueCount: 1 });
    expect(today.emergency).toMatchObject({ openRequest: null, emergencyNumber: "112" });
  });

  it("drops an attention item once someone takes care of it", async () => {
    const { admin, family, circle, as } = await busyCircle();
    const appt = (await getCircleToday(as(admin, NOON), circle.id)).appointments!.upcoming[0];
    await assignHelper(as(family, NOON), circle.id, appt.id, { role: "transport", memberId: family.memberId });
    expect((await getCircleToday(as(admin, NOON), circle.id)).attention.map((a) => a.kind)).not.toContain("needs_driver");
  });

  it("puts a real open help request first, but not a practice drill", async () => {
    const { admin, elder, circle, as } = await busyCircle();
    await raiseAssistance(as(elder, NOON), circle.id, { practice: true });
    expect((await getCircleToday(as(admin, NOON), circle.id)).attention[0].kind).not.toBe("open_help_request");
    const real = await raiseAssistance(as(elder, NOON), circle.id, { message: "Dizzy" });
    expect((await getCircleToday(as(admin, NOON), circle.id)).attention[0]).toMatchObject({ kind: "open_help_request", requestId: real.id });
  });

  it("reports the last recorded activity and who recorded it, never a 'safe' verdict", async () => {
    const { admin, family, circle, as } = await busyCircle();
    expect((await getCircleToday(as(admin, NOON), circle.id)).lastRecordedActivity).toMatchObject({ kind: "dose", by: "Amma" });
    await postUpdate(as(family, ist(DAY, "12:30")), circle.id, { body: "Called her, all fine" });
    const later = await getCircleToday(as(admin, ist(DAY, "13:00")), circle.id);
    expect(later.lastRecordedActivity).toMatchObject({ kind: "update", by: "Ravi" });
    expect(JSON.stringify(later)).not.toMatch(/"(safe|ok|fine)"\s*:\s*true/i);
  });

  it("each section follows the viewer's permissions and the recipient's sharing choices", async () => {
    const { elder, family, caregiver, neighbour, circle, as } = await busyCircle();
    const forNeighbour = await getCircleToday(as(neighbour, NOON), circle.id);
    expect(forNeighbour).toMatchObject({ medicines: null, appointments: null, tasks: null, visits: null, lastRecordedActivity: null });
    expect(forNeighbour.emergency).not.toBeNull();
    expect(forNeighbour.attention.map((a) => a.kind)).toEqual([]);

    await putConsentFor(elder, circle.id, { shareMedications: false, shareAppointments: false, shareHealth: true });
    const forFamily = await getCircleToday(as(family, NOON), circle.id);
    expect(forFamily.medicines).toBeNull();
    expect(forFamily.appointments).toBeNull();
    expect(forFamily.attention.map((a) => a.kind)).not.toContain("dose_unconfirmed");
    expect((await getCircleToday(as(caregiver, NOON), circle.id)).medicines).not.toBeNull();
  });

  it("is 404 for outsiders and 401 when signed out", async () => {
    const { circle } = await busyCircle();
    const outsider = await signUp();
    expect((await circleTodayRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/today`, { cookie: outsider.cookie }), params({ circleId: circle.id }))).status).toBe(404);
    expect((await circleTodayRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/today`), params({ circleId: circle.id }))).status).toBe(401);
  });
});

describe("my 'today' across circles (Scenario F)", () => {
  it("summarises each parent's circle separately, with unread notifications", async () => {
    const child = await signUp({ name: "Priya" });
    const mum = await createTestCircle(child, { name: "Mum" });
    const dad = await createTestCircle(child, { name: "Dad", recipient: { displayName: "Dad" } });
    await createTask({ db: db(), now: NOON, userId: child.id }, mum.id, { title: "Mum task", dueAt: ist(DAY, "09:00").toISOString() });
    const mine = await getMyToday({ db: db(), now: NOON, userId: child.id });
    expect(mine.circles.map((c) => c.circle.name)).toEqual(["Mum", "Dad"]);
    expect(mine.circles[0].attention.map((a) => a.kind).sort()).toEqual(["overdue_task", "unassigned_task"]);
    expect(mine.circles[1].attention).toEqual([]);
    expect(dad.id).toBe(mine.circles[1].circle.id);

    const res = await myTodayRoute(apiRequest("GET", "/api/v1/me/today", { cookie: child.cookie }));
    expect(res.status).toBe(200);
    expect((await res.json()).unreadNotifications).toBe(0);
  });
});
