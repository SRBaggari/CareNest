import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as timelineRoute } from "@/app/api/v1/circles/[circleId]/timeline/route";
import { notifications } from "@/server/db/schema";
import { completeAppointment, createAppointment } from "@/server/services/appointments";
import { listDoses, recordDose } from "@/server/services/doses";
import { createMedication } from "@/server/services/medications";
import { completeTask, createTask } from "@/server/services/tasks";
import { getTimeline } from "@/server/services/timeline";
import { listUpdates, postUpdate } from "@/server/services/updates";
import { checkOut, createVisit } from "@/server/services/visits";
import { createTeam } from "../helpers/circles";
import { putConsentFor } from "../helpers/consent";
import { setupTestDb } from "../helpers/db";
import { setupFakeEmail } from "../helpers/email";
import { apiRequest, params } from "../helpers/http";
import { signUp } from "../helpers/users";

const db = setupTestDb();
setupFakeEmail();
const ist = (time: string) => new Date(`2026-11-14T${time}:00+05:30`);

/** A day in Amma's care: medicine, a visit, an appointment, a task and two updates. */
async function busyDay() {
  const team = await createTeam(db());
  const { admin, elder, family, caregiver, circle, as } = team;
  await createMedication(as(admin, ist("06:00")), circle.id, { name: "Metformin", dosage: "500 mg", startDate: "2026-11-14", asNeeded: false, times: ["08:00"], unitsPerDose: 1 });
  const { doses } = await listDoses(as(elder, ist("08:05")), circle.id, { date: "2026-11-14", days: 1 });
  await recordDose(as(elder, ist("08:05")), circle.id, doses[0].id, { status: "taken" });
  const visit = await createVisit(as(caregiver, ist("09:00")), circle.id, { startNow: true });
  await checkOut(as(caregiver, ist("11:00")), circle.id, visit.id, { observations: "Seemed tired" });
  const appt = await createAppointment(as(admin, ist("06:00")), circle.id, { title: "Eye check", kind: "in_person", transportNeeded: false, startsAt: ist("12:00").toISOString() });
  await completeAppointment(as(admin, ist("13:30")), circle.id, appt.id, { outcomeNote: "New glasses needed" });
  const task = await createTask(as(admin, ist("06:00")), circle.id, { title: "Order new glasses" });
  await completeTask(as(family, ist("15:00")), circle.id, task.id, {});
  await postUpdate(as(family, ist("16:00")), circle.id, { body: "Called Amma, she sounded cheerful" });
  await postUpdate(as(caregiver, ist("17:00")), circle.id, { body: "Mild knee pain in the evening", category: "health" });
  return team;
}

describe("unified care timeline", () => {
  it("shows every kind of event, newest first, each with who recorded it and how", async () => {
    const { admin, circle, as } = await busyDay();
    const { items } = await getTimeline(as(admin, ist("18:00")), circle.id, {});
    expect(items.map((i) => [i.kind, i.actor])).toEqual([
      ["update", "Meena"],
      ["update", "Ravi"],
      ["task", "Ravi"],
      ["appointment", "Priya"],
      ["visit", "Meena"],
      ["dose", "Amma"],
      ["medication", "Priya"],
    ]);
    const dose = items.find((i) => i.kind === "dose")!;
    expect(dose).toMatchObject({ source: "self", data: { status: "taken", medicine: "Metformin", scheduledTime: "08:00" } });
    expect(items.find((i) => i.kind === "appointment")!.data).toMatchObject({ status: "completed", outcomeNote: "New glasses needed" });
  });

  it("hides what a viewer may not see: medicines, appointments and health notes follow the parent's sharing", async () => {
    const { elder, family, caregiver, circle, as } = await busyDay();
    await putConsentFor(elder, circle.id, { shareMedications: false, shareAppointments: false, shareHealth: false });
    const familyView = await getTimeline(as(family, ist("18:00")), circle.id, {});
    expect(familyView.items.map((i) => i.kind).sort()).toEqual(["task", "update", "visit"]);
    expect(familyView.items.find((i) => i.kind === "visit")!.data).toMatchObject({ observations: null, detailsHidden: true });
    expect(familyView.items.filter((i) => i.kind === "update").map((i) => i.data.body)).toEqual(["Called Amma, she sounded cheerful"]);

    const caregiverView = await getTimeline(as(caregiver, ist("18:00")), circle.id, {});
    expect(caregiverView.items).toHaveLength(7);
  });

  it("emergency contacts and outsiders cannot read the timeline", async () => {
    const { neighbour, circle, as } = await busyDay();
    await expect(getTimeline(as(neighbour, ist("18:00")), circle.id, {})).rejects.toMatchObject({ code: "forbidden" });
    const outsider = await signUp();
    const res = await timelineRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/timeline`, { cookie: outsider.cookie }), params({ circleId: circle.id }));
    expect(res.status).toBe(404);
  });

  it("filters by kind, searches text, and pages with a cursor", async () => {
    const { admin, circle, as } = await busyDay();
    const onlyTasks = await getTimeline(as(admin, ist("18:00")), circle.id, { kinds: "task,appointment" });
    expect(onlyTasks.items.map((i) => i.kind)).toEqual(["task", "appointment"]);
    const searched = await getTimeline(as(admin, ist("18:00")), circle.id, { q: "glasses" });
    expect(searched.items.map((i) => i.kind).sort()).toEqual(["appointment", "task"]);
    const page1 = await getTimeline(as(admin, ist("18:00")), circle.id, { limit: 3 });
    expect(page1.items).toHaveLength(3);
    const page2 = await getTimeline(as(admin, ist("18:00")), circle.id, { limit: 3, before: page1.nextBefore! });
    expect(page2.items.map((i) => i.kind)).toEqual(["appointment", "visit", "dose"]);
  });

  it("search input with SQL wildcards is treated literally", async () => {
    const { admin, circle, as } = await busyDay();
    expect((await getTimeline(as(admin, ist("18:00")), circle.id, { q: "%" })).items).toHaveLength(0);
  });
});

describe("care updates", () => {
  it("corrections are new entries linked to the original, which is marked as corrected", async () => {
    const { family, circle, as } = await createTeam(db());
    const original = await postUpdate(as(family, ist("10:00")), circle.id, { body: "Amma ate lunch at 1pm" });
    await postUpdate(as(family, ist("10:05")), circle.id, { body: "Correction: she ate lunch at 2pm", correctsUpdateId: original.id });
    const updates = await listUpdates(as(family, ist("11:00")), circle.id, { limit: 10 });
    expect(updates.map((u) => [u.body, u.correctsUpdateId === original.id, u.correctedBy !== null])).toEqual([
      ["Correction: she ate lunch at 2pm", true, false],
      ["Amma ate lunch at 1pm", false, true],
    ]);
  });

  it("only the author can correct their update", async () => {
    const { family, admin, circle, as } = await createTeam(db());
    const original = await postUpdate(as(family, ist("10:00")), circle.id, { body: "x" });
    await expect(postUpdate(as(admin, ist("10:05")), circle.id, { body: "y", correctsUpdateId: original.id })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("health notes need health access to post; emergency contacts can't post", async () => {
    const { elder, family, neighbour, circle, as } = await createTeam(db());
    await putConsentFor(elder, circle.id, { shareMedications: true, shareAppointments: true, shareHealth: false });
    await expect(postUpdate(as(family, ist("10:00")), circle.id, { body: "BP 150/90", category: "health" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(postUpdate(as(neighbour, ist("10:00")), circle.id, { body: "hi" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("important updates notify everyone who may see them, except the author, without the text in email", async () => {
    const { caregiver, family, admin, elder, circle, as } = await createTeam(db());
    await putConsentFor(elder, circle.id, { shareMedications: true, shareAppointments: true, shareHealth: false });
    await postUpdate(as(caregiver, ist("10:00")), circle.id, { body: "Fell in the bathroom, no injury, doctor called", category: "health", important: true });
    const inbox = async (u: { id: string }) => db().select().from(notifications).where(eq(notifications.userId, u.id));
    expect(await inbox(family)).toHaveLength(0);
    expect(await inbox(admin)).toHaveLength(0);
    expect((await inbox(elder))[0]).toMatchObject({ kind: "important_update", title: "Important update from Meena", priority: "high" });
    expect(await inbox(caregiver)).toHaveLength(0);

    await postUpdate(as(caregiver, ist("11:00")), circle.id, { body: "Plumber coming at 4pm", important: true });
    expect((await inbox(family))[0].body).toBe("Plumber coming at 4pm");
  });
});
