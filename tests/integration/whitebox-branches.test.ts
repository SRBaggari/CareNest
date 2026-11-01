// White-box branch tests: written from reading the code's branches that the feature tests did
// not reach, prioritising safety-relevant paths (sessions, emergencies, invitations, doses).

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { assistanceRequests, doseEvents, invitations, sessions } from "@/server/db/schema";
import { createSession, SESSION_TTL_MS, validateSessionToken } from "@/server/auth/session";
import { acknowledgeAssistance, cancelAssistance, getAssistance, raiseAssistance, resolveAssistance } from "@/server/services/assistance";
import { archiveCircle } from "@/server/services/circles";
import { listDoses, recordAsNeededDose, recordDose } from "@/server/services/doses";
import { acceptInvitation, createInvitation, INVITATIONS_PER_USER_PER_DAY, revokeInvitation } from "@/server/services/invitations";
import { createMedication, stopMedication, updateMedication } from "@/server/services/medications";
import { claimTask, completeTask, createTask, listTasks, setTaskStatus, updateTask } from "@/server/services/tasks";
import { createTeam, createTestCircle } from "../helpers/circles";
import { setupTestDb } from "../helpers/db";
import { setupFakeEmail } from "../helpers/email";
import { signUp } from "../helpers/users";

const db = setupTestDb();
setupFakeEmail();
const T0 = new Date("2026-11-14T04:00:00Z");
const at = (h: number) => new Date(T0.getTime() + h * 3_600_000);

describe("sessions: sliding expiry", () => {
  it("extends a session used within 15 days of expiry, and leaves a fresh one alone", async () => {
    const user = await signUp();
    const { token, sessionId } = await createSession(db(), { userId: user.id, now: T0 });
    const fresh = await validateSessionToken(db(), token, at(1));
    expect(fresh?.expiresAt.getTime()).toBe(T0.getTime() + SESSION_TTL_MS);

    const day20 = new Date(T0.getTime() + 20 * 24 * 3_600_000);
    const renewed = await validateSessionToken(db(), token, day20);
    expect(renewed?.expiresAt.getTime()).toBe(day20.getTime() + SESSION_TTL_MS);
    const [row] = await db().select().from(sessions).where(eq(sessions.id, sessionId));
    expect(row.expiresAt.getTime()).toBe(day20.getTime() + SESSION_TTL_MS);
    expect(row.lastSeenAt.getTime()).toBe(day20.getTime());
  });

  it("rejects absurdly long tokens without a database lookup", async () => {
    expect(await validateSessionToken(db(), "x".repeat(101), T0)).toBeNull();
  });
});

describe("emergency: edge branches", () => {
  it("a parent alone in their circle can still ask for help; the report shows nobody was alerted", async () => {
    const elder = await signUp({ name: "Lakshmi" });
    const circle = await createTestCircle(elder, { creatorRole: "care_recipient" });
    const as = { db: db(), now: T0, userId: elder.id };
    const req = await raiseAssistance(as, circle.id, { message: "Dizzy" });
    expect(req).toMatchObject({ status: "open", deliveries: [], nextEscalationAt: null });
  });

  it("acknowledging twice is harmless; closed requests can't be resolved or cancelled", async () => {
    const { elder, family, admin, circle, as } = await createTeam(db());
    const req = await raiseAssistance(as(elder, T0), circle.id, {});
    await acknowledgeAssistance(as(family, at(0.1)), circle.id, req.id);
    expect((await acknowledgeAssistance(as(admin, at(0.2)), circle.id, req.id)).acknowledgedBy).toBe("Ravi");
    await resolveAssistance(as(family, at(1)), circle.id, req.id, { note: "OK" });
    await expect(resolveAssistance(as(admin, at(2)), circle.id, req.id, { note: "again" })).rejects.toMatchObject({ code: "conflict" });
    await expect(cancelAssistance(as(admin, at(2)), circle.id, req.id)).rejects.toMatchObject({ code: "conflict" });
  });

  it("resolving without a prior acknowledgement records the resolver as the responder", async () => {
    const { elder, caregiver, circle, as } = await createTeam(db());
    const req = await raiseAssistance(as(elder, T0), circle.id, {});
    const done = await resolveAssistance(as(caregiver, at(0.5)), circle.id, req.id, { note: "Found her keys" });
    expect(done).toMatchObject({ status: "resolved", acknowledgedBy: "Meena", resolvedBy: "Meena" });
    const [row] = await db().select().from(assistanceRequests).where(eq(assistanceRequests.id, req.id));
    expect(row.nextEscalationAt).toBeNull();
  });

  it("malformed and unknown request ids are 404", async () => {
    const { admin, circle, as } = await createTeam(db());
    await expect(getAssistance(as(admin, T0), circle.id, "nope")).rejects.toMatchObject({ code: "not_found" });
    await expect(acknowledgeAssistance(as(admin, T0), circle.id, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "not_found" });
  });

  it("an admin can call a false alarm raised by someone else", async () => {
    const { elder, admin, circle, as } = await createTeam(db());
    const req = await raiseAssistance(as(elder, T0), circle.id, {});
    expect((await cancelAssistance(as(admin, at(0.1)), circle.id, req.id)).status).toBe("cancelled");
  });
});

describe("invitations: edge branches", () => {
  it("rate-limits invitations per person per day", async () => {
    const { admin, circle, as } = await createTeam(db());
    for (let i = 0; i < INVITATIONS_PER_USER_PER_DAY; i++) {
      await createInvitation(as(admin, T0), circle.id, { email: `p${i}@example.test`, role: "family" }, "http://localhost");
    }
    await expect(createInvitation(as(admin, T0), circle.id, { email: "one-more@example.test", role: "family" }, "http://localhost")).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("can't be accepted once the circle is archived", async () => {
    const { admin, circle, as } = await createTeam(db());
    const invitee = await signUp();
    const { inviteUrl } = await createInvitation(as(admin, T0), circle.id, { email: invitee.email, role: "family" }, "http://localhost");
    await archiveCircle(as(admin, at(1)), circle.id);
    await expect(acceptInvitation({ db: db(), now: at(2), userId: invitee.id, userEmail: invitee.email }, inviteUrl.split("/").pop()!)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("an existing member accepting keeps their current role", async () => {
    const { admin, family, circle, as } = await createTeam(db());
    const { inviteUrl } = await createInvitation(as(admin, T0), circle.id, { email: "x@example.test", role: "clinician" }, "http://localhost");
    // Point the pending invitation at Ravi's email to simulate a duplicate invite to a member.
    await db().update(invitations).set({ email: family.email }).where(eq(invitations.circleId, circle.id));
    const res = await acceptInvitation({ db: db(), now: at(1), userId: family.id, userEmail: family.email }, inviteUrl.split("/").pop()!);
    expect(res.circleId).toBe(circle.id);
    const { getCircle } = await import("@/server/services/circles");
    expect((await getCircle(as(family, at(1)), circle.id)).myMembership.role).toBe("family");
  });

  it("revoking an unknown or malformed invitation is 404", async () => {
    const { admin, circle, as } = await createTeam(db());
    await expect(revokeInvitation(as(admin, T0), circle.id, "nope")).rejects.toMatchObject({ code: "not_found" });
    await expect(revokeInvitation(as(admin, T0), circle.id, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("medicines: edge branches", () => {
  it("a non-schedule edit (dose text) keeps upcoming doses; a schedule edit replaces them", async () => {
    const { admin, circle, as } = await createTeam(db());
    const med = await createMedication(as(admin, T0), circle.id, { name: "Amlodipine", dosage: "5 mg", startDate: "2026-11-14", asNeeded: false, times: ["20:00"], unitsPerDose: 1 });
    const before = (await listDoses(as(admin, T0), circle.id, { date: "2026-11-14", days: 1 })).doses.map((d) => d.id);
    await updateMedication(as(admin, at(1)), circle.id, med.id, { version: 1, dosage: "5 mg (1 tablet)" });
    expect((await listDoses(as(admin, at(1)), circle.id, { date: "2026-11-14", days: 1 })).doses.map((d) => d.id)).toEqual(before);
    await updateMedication(as(admin, at(2)), circle.id, med.id, { version: 2, times: ["21:00"] });
    const after = (await listDoses(as(admin, at(2)), circle.id, { date: "2026-11-14", days: 1 })).doses;
    expect(after.map((d) => d.localTime)).toEqual(["21:00"]);
  });

  it("switching to as-needed clears the times; end before start is rejected on update", async () => {
    const { admin, circle, as } = await createTeam(db());
    const med = await createMedication(as(admin, T0), circle.id, { name: "X", dosage: "1", startDate: "2026-11-14", asNeeded: false, times: ["08:00"], unitsPerDose: 1 });
    expect((await updateMedication(as(admin, T0), circle.id, med.id, { version: 1, asNeeded: true })).times).toEqual([]);
    await expect(updateMedication(as(admin, T0), circle.id, med.id, { version: 2, endDate: "2026-11-01" })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("stopping twice is harmless; as-needed doses can't be recorded for a stopped medicine", async () => {
    const { admin, caregiver, circle, as } = await createTeam(db());
    const prn = await createMedication(as(admin, T0), circle.id, { name: "Paracetamol", dosage: "1", asNeeded: true, times: [], unitsPerDose: 1 });
    await stopMedication(as(admin, at(1)), circle.id, prn.id, {});
    expect((await stopMedication(as(admin, at(2)), circle.id, prn.id, {})).status).toBe("stopped");
    await expect(recordAsNeededDose(as(caregiver, at(3)), circle.id, prn.id, { status: "administered" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("an as-needed dose can be corrected within the window", async () => {
    const { admin, caregiver, circle, as } = await createTeam(db());
    const prn = await createMedication(as(admin, T0), circle.id, { name: "Paracetamol", dosage: "1", asNeeded: true, times: [], unitsPerDose: 1 });
    const dose = await recordAsNeededDose(as(caregiver, at(1)), circle.id, prn.id, { status: "administered" });
    expect((await recordDose(as(caregiver, at(2)), circle.id, dose.id, { status: "refused", reason: "Spat it out" }))?.status).toBe("refused");
    const [row] = await db().select().from(doseEvents).where(eq(doseEvents.id, dose.id));
    expect(row.status).toBe("refused");
  });
});

describe("tasks: edge branches", () => {
  it("closed tasks can't be edited or claimed; claiming your own task twice is harmless", async () => {
    const { admin, family, circle, as } = await createTeam(db());
    const task = await createTask(as(admin, T0), circle.id, { title: "Book cab" });
    await claimTask(as(family, T0), circle.id, task.id, "claim");
    expect((await claimTask(as(family, T0), circle.id, task.id, "claim")).assignee?.name).toBe("Ravi");
    await completeTask(as(family, at(1)), circle.id, task.id, {});
    await expect(updateTask(as(admin, at(2)), circle.id, task.id, { version: 3, title: "x" })).rejects.toMatchObject({ code: "conflict" });
    await expect(claimTask(as(admin, at(2)), circle.id, task.id, "claim")).rejects.toMatchObject({ code: "conflict" });
  });

  it("making a task repeat without a due date is rejected on update", async () => {
    const { admin, circle, as } = await createTeam(db());
    const task = await createTask(as(admin, T0), circle.id, { title: "Water plants" });
    await expect(updateTask(as(admin, T0), circle.id, task.id, { version: 1, recurrence: "weekly" })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("reopen/cancel rules: caregivers can't, reopening an open task is a no-op, cancelling a done task conflicts", async () => {
    const { admin, caregiver, circle, as } = await createTeam(db());
    const task = await createTask(as(admin, T0), circle.id, { title: "x" });
    await expect(setTaskStatus(as(caregiver, T0), circle.id, task.id, "cancel")).rejects.toMatchObject({ code: "forbidden" });
    expect((await setTaskStatus(as(admin, T0), circle.id, task.id, "reopen")).status).toBe("open");
    await completeTask(as(admin, T0), circle.id, task.id, {});
    await expect(setTaskStatus(as(admin, T0), circle.id, task.id, "cancel")).rejects.toMatchObject({ code: "conflict" });
  });

  it("'all' lists open and done together; malformed ids are 404", async () => {
    const { admin, circle, as } = await createTeam(db());
    const a = await createTask(as(admin, T0), circle.id, { title: "a" });
    await createTask(as(admin, T0), circle.id, { title: "b" });
    await completeTask(as(admin, T0), circle.id, a.id, {});
    expect(await listTasks(as(admin, T0), circle.id, { status: "all", assignee: "any" })).toHaveLength(2);
    await expect(completeTask(as(admin, T0), circle.id, "nope", {})).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("every id-taking endpoint answers 404 (never 500) for malformed ids", () => {
  it("covers all circle sub-resources through the real route handlers", async () => {
    const { apiRequest, params } = await import("../helpers/http");
    const { admin, circle } = await createTeam(db());
    const c = circle.id;
    const bad = "not-a-uuid";
    const cases: [string, string, (r: Request, p: never) => Promise<Response>, Record<string, string>, unknown?][] = [
      ["GET", `medications/${bad}`, (await import("@/app/api/v1/circles/[circleId]/medications/[medicationId]/route")).GET, { medicationId: bad }],
      ["POST", `medications/${bad}/stop`, (await import("@/app/api/v1/circles/[circleId]/medications/[medicationId]/stop/route")).POST, { medicationId: bad }, {}],
      ["POST", `medications/${bad}/restock`, (await import("@/app/api/v1/circles/[circleId]/medications/[medicationId]/restock/route")).POST, { medicationId: bad }, { supplyCount: 1 }],
      ["POST", `doses/${bad}/record`, (await import("@/app/api/v1/circles/[circleId]/doses/[doseId]/record/route")).POST, { doseId: bad }, { status: "taken" }],
      ["GET", `doses/${bad}/history`, (await import("@/app/api/v1/circles/[circleId]/doses/[doseId]/history/route")).GET, { doseId: bad }],
      ["GET", `appointments/${bad}`, (await import("@/app/api/v1/circles/[circleId]/appointments/[appointmentId]/route")).GET, { appointmentId: bad }],
      ["PUT", `appointments/${bad}/helpers`, (await import("@/app/api/v1/circles/[circleId]/appointments/[appointmentId]/helpers/route")).PUT, { appointmentId: bad }, { role: "transport", memberId: null }],
      ["GET", `tasks/${bad}`, (await import("@/app/api/v1/circles/[circleId]/tasks/[taskId]/route")).GET, { taskId: bad }],
      ["POST", `tasks/${bad}/claim`, (await import("@/app/api/v1/circles/[circleId]/tasks/[taskId]/claim/route")).POST, { taskId: bad }, { action: "claim" }],
      ["POST", `tasks/${bad}/complete`, (await import("@/app/api/v1/circles/[circleId]/tasks/[taskId]/complete/route")).POST, { taskId: bad }, {}],
      ["POST", `tasks/${bad}/status`, (await import("@/app/api/v1/circles/[circleId]/tasks/[taskId]/status/route")).POST, { taskId: bad }, { action: "cancel" }],
      ["POST", `visits/${bad}/check-in`, (await import("@/app/api/v1/circles/[circleId]/visits/[visitId]/check-in/route")).POST, { visitId: bad }],
      ["POST", `visits/${bad}/cancel`, (await import("@/app/api/v1/circles/[circleId]/visits/[visitId]/cancel/route")).POST, { visitId: bad }, { reason: "x" }],
      ["PATCH", `members/${bad}`, (await import("@/app/api/v1/circles/[circleId]/members/[memberId]/route")).PATCH, { memberId: bad }, { role: "family" }],
      ["DELETE", `invitations/${bad}`, (await import("@/app/api/v1/circles/[circleId]/invitations/[invitationId]/route")).DELETE, { invitationId: bad }],
      ["PATCH", `emergency/contacts/${bad}`, (await import("@/app/api/v1/circles/[circleId]/emergency/contacts/[contactId]/route")).PATCH, { contactId: bad }, { tier: 2 }],
      ["GET", `emergency/requests/${bad}`, (await import("@/app/api/v1/circles/[circleId]/emergency/requests/[requestId]/route")).GET, { requestId: bad }],
      ["POST", `emergency/requests/${bad}/acknowledge`, (await import("@/app/api/v1/circles/[circleId]/emergency/requests/[requestId]/acknowledge/route")).POST, { requestId: bad }],
    ];
    const statuses: Record<string, number> = {};
    for (const [method, path, handler, p, body] of cases) {
      const res = await handler(apiRequest(method, `/api/v1/circles/${c}/${path}`, { cookie: admin.cookie, body }), params({ circleId: c, ...p }) as never);
      statuses[`${method} ${path}`] = res.status;
    }
    expect(Object.entries(statuses).filter(([, s]) => s !== 404)).toEqual([]);
  });
});
