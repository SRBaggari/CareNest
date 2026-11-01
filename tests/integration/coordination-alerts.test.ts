import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { notifications } from "@/server/db/schema";
import { assignHelper, createAppointment, updateAppointment } from "@/server/services/appointments";
import { putConsentFor } from "../helpers/consent";
import { claimTask, completeTask, createTask } from "@/server/services/tasks";
import { updateMyAlertSettings } from "@/server/services/notifications";
import { runTick } from "@/server/worker/tick";
import { createTeam } from "../helpers/circles";
import { setupTestDb } from "../helpers/db";
import { setupFakeEmail } from "../helpers/email";

const db = setupTestDb();
setupFakeEmail();
const T0 = new Date("2026-11-14T04:00:00Z"); // 09:30 in Kolkata
const at = (h: number) => new Date(T0.getTime() + h * 3_600_000);

async function inbox(user: { id: string }, kind: string) {
  return (await db().select().from(notifications).where(eq(notifications.userId, user.id))).filter((n) => n.kind === kind);
}

describe("appointment alerts", () => {
  it("asks family and admins for a driver within 72 hours, once", async () => {
    const { admin, family, caregiver, elder, circle, as } = await createTeam(db());
    await createAppointment(as(admin, T0), circle.id, { title: "Cardiology", kind: "in_person", transportNeeded: true, startsAt: at(80).toISOString() });
    await runTick(db(), T0);
    expect(await inbox(family, "transport_needed")).toHaveLength(0);
    await runTick(db(), at(9));
    const [alert] = await inbox(family, "transport_needed");
    expect(alert).toMatchObject({ title: "Nobody is taking Amma to Cardiology yet", priority: "high" });
    expect(await inbox(admin, "transport_needed")).toHaveLength(1);
    expect(await inbox(caregiver, "transport_needed")).toHaveLength(0);
    expect(await inbox(elder, "transport_needed")).toHaveLength(0);
    await runTick(db(), at(10));
    expect(await inbox(family, "transport_needed")).toHaveLength(1);
  });

  it("no driver alert once someone has volunteered, or for virtual appointments", async () => {
    const { admin, family, circle, as } = await createTeam(db());
    const appt = await createAppointment(as(admin, T0), circle.id, { title: "Eye check", kind: "in_person", transportNeeded: true, startsAt: at(30).toISOString() });
    await assignHelper(as(family, T0), circle.id, appt.id, { role: "transport", memberId: family.memberId });
    await createAppointment(as(admin, T0), circle.id, { title: "Video call", kind: "virtual", transportNeeded: true, startsAt: at(30).toISOString() });
    await runTick(db(), at(1));
    expect(await inbox(admin, "transport_needed")).toHaveLength(0);
  });

  it("reminds the parent and the driver a day ahead, with who is driving", async () => {
    const { admin, family, elder, caregiver, circle, as } = await createTeam(db());
    const appt = await createAppointment(as(admin, T0), circle.id, { title: "Cardiology", kind: "in_person", transportNeeded: true, startsAt: at(30).toISOString() });
    await assignHelper(as(family, T0), circle.id, appt.id, { role: "transport", memberId: family.memberId });
    await runTick(db(), at(7));
    const [reminder] = await inbox(elder, "appointment_reminder");
    expect(reminder.title).toBe("Coming up: Cardiology");
    expect(reminder.body).toContain("Driving: Ravi");
    expect(await inbox(family, "appointment_reminder")).toHaveLength(1);
    expect(await inbox(caregiver, "appointment_reminder")).toHaveLength(0);
    expect(await inbox(admin, "appointment_reminder")).toHaveLength(0);
  });

  it("rescheduling re-arms the reminder", async () => {
    const { admin, elder, circle, as } = await createTeam(db());
    const appt = await createAppointment(as(admin, T0), circle.id, { title: "Dentist", kind: "in_person", transportNeeded: false, startsAt: at(10).toISOString() });
    await runTick(db(), at(1));
    await updateAppointment(as(admin, at(2)), circle.id, appt.id, { version: 1, startsAt: at(40).toISOString() });
    await runTick(db(), at(17));
    expect(await inbox(elder, "appointment_reminder")).toHaveLength(2);
  });

  it("respects the parent's choice not to share appointments", async () => {
    const { admin, family, elder, circle, as } = await createTeam(db());
    await createAppointment(as(admin, T0), circle.id, { title: "Private visit", kind: "in_person", transportNeeded: true, startsAt: at(20).toISOString() });
    await putConsentFor(elder, circle.id, { shareMedications: true, shareAppointments: false, shareHealth: true });
    await runTick(db(), at(1));
    expect(await inbox(family, "transport_needed")).toHaveLength(0);
    expect(await inbox(admin, "transport_needed")).toHaveLength(0);
    expect(await inbox(elder, "appointment_reminder")).toHaveLength(1);
  });
});

describe("task alerts: nothing silently forgotten", () => {
  it("asks for a volunteer when a task due within 48 hours has nobody", async () => {
    const { admin, family, caregiver, elder, circle, as } = await createTeam(db());
    await createTask(as(admin, T0), circle.id, { title: "Buy BP medicine", dueAt: at(30).toISOString() });
    await runTick(db(), T0);
    expect((await inbox(family, "task_unassigned"))[0]).toMatchObject({ title: "Nobody has taken: Buy BP medicine", priority: "high" });
    expect(await inbox(admin, "task_unassigned")).toHaveLength(1);
    expect(await inbox(caregiver, "task_unassigned")).toHaveLength(0);
    expect(await inbox(elder, "task_unassigned")).toHaveLength(0);
  });

  it("reminds the assignee when it's due soon, and escalates to admins a day after it's overdue", async () => {
    const { admin, family, circle, as } = await createTeam(db());
    await createTask(as(admin, T0), circle.id, { title: "Pay hospital bill", dueAt: at(5).toISOString(), assigneeMemberId: family.memberId });
    await runTick(db(), at(1));
    expect(await inbox(family, "task_due")).toHaveLength(0);
    await runTick(db(), at(2.5));
    expect((await inbox(family, "task_due"))[0].title).toBe("Due soon: Pay hospital bill");

    await runTick(db(), at(28));
    expect(await inbox(admin, "task_overdue")).toHaveLength(0);
    await runTick(db(), at(29.5));
    const [overdue] = await inbox(admin, "task_overdue");
    expect(overdue.body).toContain("It's with Ravi.");
    expect(await inbox(family, "task_overdue")).toHaveLength(1);
    await runTick(db(), at(40));
    expect(await inbox(admin, "task_overdue")).toHaveLength(1);
  });

  it("completed tasks raise nothing; claiming re-arms the due reminder for the new person", async () => {
    const { admin, family, caregiver, circle, as } = await createTeam(db());
    const done = await createTask(as(admin, T0), circle.id, { title: "Done early", dueAt: at(2).toISOString(), assigneeMemberId: family.memberId });
    await completeTask(as(family, T0), circle.id, done.id, {});
    const open = await createTask(as(admin, T0), circle.id, { title: "Collect report", dueAt: at(2).toISOString() });
    await runTick(db(), at(0.5));
    await claimTask(as(caregiver, at(0.6)), circle.id, open.id, "claim");
    await runTick(db(), at(0.7));
    expect(await inbox(family, "task_due")).toHaveLength(0);
    expect((await inbox(caregiver, "task_due"))[0].title).toBe("Due soon: Collect report");
    await runTick(db(), at(30));
    expect((await inbox(admin, "task_overdue")).map((n) => n.title)).toEqual(["Overdue: Collect report"]);
  });
});

describe("choosing not to get appointment and task alerts", () => {
  it("stops driver requests and reminders for whoever opts out, but never for the person driving", async () => {
    const { admin, family, elder, circle, as } = await createTeam(db());
    await updateMyAlertSettings(as(family, T0), circle.id, { appointments: false });
    await updateMyAlertSettings(as(elder, T0), circle.id, { appointments: false });
    const appt = await createAppointment(as(admin, T0), circle.id, { title: "Cardiology", kind: "in_person", transportNeeded: true, startsAt: at(30).toISOString() });
    await runTick(db(), at(1));
    expect(await inbox(family, "transport_needed")).toHaveLength(0);
    expect(await inbox(admin, "transport_needed")).toHaveLength(1);

    // Ravi opted out, but once he offers to drive he's told about the appointment anyway.
    await assignHelper(as(family, at(2)), circle.id, appt.id, { role: "transport", memberId: family.memberId });
    await runTick(db(), at(7));
    expect(await inbox(family, "appointment_reminder")).toHaveLength(1);
    expect(await inbox(elder, "appointment_reminder")).toHaveLength(0);
  });

  it("stops unclaimed and overdue task alerts for organisers who opt out, but never for the assignee", async () => {
    const { admin, family, circle, as } = await createTeam(db());
    await updateMyAlertSettings(as(family, T0), circle.id, { tasks: false });
    await updateMyAlertSettings(as(admin, T0), circle.id, { tasks: false });
    await createTask(as(admin, T0), circle.id, { title: "Buy BP medicine", dueAt: at(30).toISOString() });
    await runTick(db(), T0);
    expect(await inbox(family, "task_unassigned")).toHaveLength(0);
    expect(await inbox(admin, "task_unassigned")).toHaveLength(0);

    await createTask(as(admin, T0), circle.id, { title: "Pay hospital bill", dueAt: at(5).toISOString(), assigneeMemberId: family.memberId });
    await runTick(db(), at(2.5));
    expect(await inbox(family, "task_due")).toHaveLength(1);
    await runTick(db(), at(29.5));
    expect(await inbox(family, "task_overdue")).toHaveLength(1);
    expect(await inbox(admin, "task_overdue")).toHaveLength(0);
  });
});

