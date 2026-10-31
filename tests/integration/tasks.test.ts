import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST as claimRoute } from "@/app/api/v1/circles/[circleId]/tasks/[taskId]/claim/route";
import { GET as listRoute } from "@/app/api/v1/circles/[circleId]/tasks/route";
import { removeMember } from "@/server/services/members";
import { tasks } from "@/server/db/schema";
import { completeAppointment, createAppointment } from "@/server/services/appointments";
import { claimTask, completeTask, createTask, listTasks, setTaskStatus, updateTask } from "@/server/services/tasks";
import { createTeam, createTestCircle } from "../helpers/circles";
import { setupTestDb } from "../helpers/db";
import { apiRequest, params } from "../helpers/http";
import { signUp } from "../helpers/users";

const db = setupTestDb();
const T0 = new Date("2026-11-14T04:00:00Z");
const at = (h: number) => new Date(T0.getTime() + h * 3_600_000);

describe("family tasks", () => {
  it("creates tasks, shows unassigned ones, and lets someone claim them", async () => {
    const { admin, family, circle, as } = await createTeam(db());
    const task = await createTask(as(admin, T0), circle.id, { title: "Buy BP medicine", category: "medication", dueAt: at(24).toISOString() });
    expect(task).toMatchObject({ status: "open", assignee: null, category: "medication", priority: "normal" });
    expect((await listTasks(as(family, T0), circle.id, { status: "open", assignee: "unassigned" })).map((t) => t.id)).toEqual([task.id]);

    const claimed = await claimTask(as(family, T0), circle.id, task.id, "claim");
    expect(claimed.assignee?.name).toBe("Ravi");
    expect((await listTasks(as(family, T0), circle.id, { status: "open", assignee: "me" })).map((t) => t.id)).toEqual([task.id]);
  });

  it("does not let a second person take a task someone already took", async () => {
    const { admin, family, caregiver, circle, as } = await createTeam(db());
    const task = await createTask(as(admin, T0), circle.id, { title: "Pay electricity bill", category: "bills" });
    await claimTask(as(family, T0), circle.id, task.id, "claim");
    await expect(claimTask(as(caregiver, T0), circle.id, task.id, "claim")).rejects.toMatchObject({ code: "conflict" });
    await expect(claimTask(as(caregiver, T0), circle.id, task.id, "release")).rejects.toMatchObject({ code: "conflict" });
    expect((await claimTask(as(family, T0), circle.id, task.id, "release")).assignee).toBeNull();
  });

  it("completes a task with a note and records who did it", async () => {
    const { admin, family, circle, as } = await createTeam(db());
    const task = await createTask(as(admin, T0), circle.id, { title: "Collect lab report" });
    const { task: done, nextTaskId } = await completeTask(as(family, at(2)), circle.id, task.id, { note: "Normal results, copy in the folder" });
    expect(done).toMatchObject({ status: "done", completedBy: "Ravi", completionNote: "Normal results, copy in the folder" });
    expect(nextTaskId).toBeNull();
    // Completing twice is harmless.
    expect((await completeTask(as(family, at(3)), circle.id, task.id, {})).task.completedBy).toBe("Ravi");
  });

  it("caregivers complete only tasks assigned to them", async () => {
    const { admin, caregiver, circle, as } = await createTeam(db());
    const theirs = await createTask(as(admin, T0), circle.id, { title: "Morning walk", assigneeMemberId: caregiver.memberId });
    const others = await createTask(as(admin, T0), circle.id, { title: "Book taxi" });
    expect((await completeTask(as(caregiver, T0), circle.id, theirs.id, {})).task.status).toBe("done");
    await expect(completeTask(as(caregiver, T0), circle.id, others.id, {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(createTask(as(caregiver, T0), circle.id, { title: "x" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("recurring tasks create their next occurrence exactly once, for the same person", async () => {
    const { admin, family, circle, as } = await createTeam(db());
    const weekly = await createTask(as(admin, T0), circle.id, {
      title: "Weekly pill organiser refill",
      recurrence: "weekly",
      dueAt: at(2).toISOString(),
      assigneeMemberId: family.memberId,
    });
    const first = await completeTask(as(family, at(3)), circle.id, weekly.id, {});
    expect(first.nextTaskId).not.toBeNull();
    const again = await completeTask(as(family, at(4)), circle.id, weekly.id, {});
    expect(again.nextTaskId).toBeNull();

    const open = await listTasks(as(admin, at(4)), circle.id, { status: "open", assignee: "any" });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ title: "Weekly pill organiser refill", recurrence: "weekly", assignee: { name: "Ravi" } });
    expect(open[0].dueAt?.toISOString()).toBe(at(2 + 24 * 7).toISOString());
  });

  it("the next occurrence is left unassigned if the person has left the circle", async () => {
    const { admin, family, circle, as } = await createTeam(db());
    const daily = await createTask(as(admin, T0), circle.id, { title: "Evening call", recurrence: "daily", dueAt: at(1).toISOString(), assigneeMemberId: family.memberId });
    await removeMember(as(admin, at(1)), circle.id, family.memberId);
    await completeTask(as(admin, at(2)), circle.id, daily.id, {});
    const [next] = await listTasks(as(admin, at(2)), circle.id, { status: "open", assignee: "any" });
    expect(next.assignee).toBeNull();
  });

  it("validates repeating tasks need a due date and assignees must be active members", async () => {
    const { admin, neighbour, circle, as } = await createTeam(db());
    await expect(createTask(as(admin, T0), circle.id, { title: "x", recurrence: "daily" })).rejects.toMatchObject({ name: "ZodError" });
    await expect(createTask(as(admin, T0), circle.id, { title: "x", assigneeMemberId: neighbour.memberId })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("edits with optimistic concurrency, cancels and reopens", async () => {
    const { admin, family, circle, as } = await createTeam(db());
    const task = await createTask(as(admin, T0), circle.id, { title: "Renew insurance" });
    const edited = await updateTask(as(family, T0), circle.id, task.id, { version: 1, priority: "high", assigneeMemberId: family.memberId });
    expect(edited).toMatchObject({ priority: "high", version: 2, assignee: { name: "Ravi" } });
    await expect(updateTask(as(admin, T0), circle.id, task.id, { version: 1, title: "stale" })).rejects.toMatchObject({ code: "conflict" });
    expect((await setTaskStatus(as(admin, T0), circle.id, task.id, "cancel")).status).toBe("cancelled");
    await expect(completeTask(as(family, T0), circle.id, task.id, {})).rejects.toMatchObject({ code: "conflict" });
    expect((await setTaskStatus(as(admin, T0), circle.id, task.id, "reopen")).status).toBe("open");
  });
});

describe("Scenario D: follow-up tasks from an appointment", () => {
  it("recording the outcome creates linked follow-up tasks", async () => {
    const { admin, family, circle, as } = await createTeam(db());
    const appt = await createAppointment(as(admin, T0), circle.id, {
      title: "Cardiology",
      kind: "in_person",
      transportNeeded: true,
      startsAt: at(-2).toISOString(),
    });
    await completeAppointment(as(admin, T0), circle.id, appt.id, {
      outcomeNote: "Stable.",
      followUpTasks: [{ title: "Book blood test", dueAt: at(24 * 14).toISOString() }, { title: "Collect new prescription" }],
    });
    const open = await listTasks(as(family, T0), circle.id, { status: "open", assignee: "any" });
    expect(open.map((t) => [t.title, t.category, t.appointmentId])).toEqual([
      ["Book blood test", "appointment", appt.id],
      ["Collect new prescription", "appointment", appt.id],
    ]);
  });
});

describe("access", () => {
  it("emergency contacts and outsiders cannot see tasks", async () => {
    const { admin, neighbour, circle, as } = await createTeam(db());
    await createTask(as(admin, T0), circle.id, { title: "x" });
    await expect(listTasks(as(neighbour, T0), circle.id, { status: "open", assignee: "any" })).rejects.toMatchObject({ code: "forbidden" });
    const outsider = await signUp();
    expect((await listRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/tasks`, { cookie: outsider.cookie }), params({ circleId: circle.id }))).status).toBe(404);
  });

  it("a task id from another circle is 404 even through your own circle", async () => {
    const { admin, circle, as } = await createTeam(db());
    const task = await createTask(as(admin, T0), circle.id, { title: "x" });
    const outsider = await signUp();
    const own = await createTestCircle(outsider);
    const res = await claimRoute(
      apiRequest("POST", `/api/v1/circles/${own.id}/tasks/${task.id}/claim`, { cookie: outsider.cookie, body: { action: "claim" } }),
      params({ circleId: own.id, taskId: task.id }),
    );
    expect(res.status).toBe(404);
    const [row] = await db().select().from(tasks).where(eq(tasks.id, task.id));
    expect(row.assigneeMemberId).toBeNull();
  });
});
