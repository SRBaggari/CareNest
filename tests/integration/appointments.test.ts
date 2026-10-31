import { describe, expect, it } from "vitest";
import { GET as auditRoute } from "@/app/api/v1/circles/[circleId]/audit/route";
import { PUT as helpersRoute } from "@/app/api/v1/circles/[circleId]/appointments/[appointmentId]/helpers/route";
import { GET as getRoute } from "@/app/api/v1/circles/[circleId]/appointments/[appointmentId]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/circles/[circleId]/appointments/route";
import {
  assignHelper,
  cancelAppointment,
  completeAppointment,
  createAppointment,
  listAppointments,
  updateAppointment,
} from "@/server/services/appointments";
import { createTeam, createTestCircle } from "../helpers/circles";
import { putConsentFor } from "../helpers/consent";
import { setupTestDb } from "../helpers/db";
import { apiRequest, params } from "../helpers/http";
import { signUp } from "../helpers/users";

const db = setupTestDb();
const T0 = new Date("2026-11-14T04:00:00Z");
const at = (n: number) => new Date(T0.getTime() + n * 3_600_000);
const hours = (n: number) => at(n).toISOString();

const cardiology = { title: "Cardiology check-up", clinician: "Dr Rao, Apollo Hospital", location: "Jubilee Hills, Hyderabad", startsAt: hours(48), questions: "Is the new dizziness related to the BP medicine?" };

describe("Scenario D: a medical appointment", () => {
  it("one sibling schedules, the other offers to drive, the appointment happens and its outcome is recorded with its author", async () => {
    const team = await createTeam(db());
    const { admin, family, circle, as } = team;

    const appt = await createAppointment(as(admin, T0), circle.id, { ...cardiology, kind: "in_person", transportNeeded: true });
    expect(appt).toMatchObject({ status: "scheduled", transportNeeded: true, transport: null, questions: cardiology.questions });

    const withDriver = await assignHelper(as(family, at(1)), circle.id, appt.id, { role: "transport", memberId: family.memberId });
    expect(withDriver.transport).toEqual({ memberId: family.memberId, name: "Ravi" });

    await expect(completeAppointment(as(family, at(10)), circle.id, appt.id, { outcomeNote: "x" })).rejects.toMatchObject({ code: "conflict" });

    const done = await completeAppointment(as(family, at(50)), circle.id, appt.id, {
      outcomeNote: "BP is fine. Dizziness probably from dehydration.",
      followUp: "Blood test in 2 weeks, review in 1 month.",
    });
    expect(done.status).toBe("completed");
    expect(done.outcome).toMatchObject({ note: "BP is fine. Dizziness probably from dehydration.", by: "Ravi" });
  });
});

describe("helpers (driver and companion)", () => {
  it("caregivers can volunteer themselves but not assign others; organisers can assign", async () => {
    const { admin, family, caregiver, elder, circle, as } = await createTeam(db());
    const appt = await createAppointment(as(admin, T0), circle.id, { ...cardiology, kind: "in_person", transportNeeded: true });
    await expect(assignHelper(as(caregiver, T0), circle.id, appt.id, { role: "transport", memberId: family.memberId })).rejects.toMatchObject({ code: "forbidden" });
    expect((await assignHelper(as(caregiver, T0), circle.id, appt.id, { role: "transport", memberId: caregiver.memberId })).transport?.name).toBe("Meena");
    expect((await assignHelper(as(admin, T0), circle.id, appt.id, { role: "companion", memberId: caregiver.memberId })).companion?.name).toBe("Meena");
    // The elder cannot be their own driver.
    await expect(assignHelper(as(admin, T0), circle.id, appt.id, { role: "transport", memberId: elder.memberId })).rejects.toMatchObject({ code: "validation_failed" });
    // The companion can step back themselves; a non-organiser can't remove someone else.
    await assignHelper(as(admin, T0), circle.id, appt.id, { role: "transport", memberId: family.memberId });
    await expect(assignHelper(as(caregiver, T0), circle.id, appt.id, { role: "transport", memberId: null })).rejects.toMatchObject({ code: "forbidden" });
    expect((await assignHelper(as(caregiver, T0), circle.id, appt.id, { role: "companion", memberId: null })).companion).toBeNull();
  });

  it("rejects members of another circle", async () => {
    const { admin, circle, as } = await createTeam(db());
    const other = await createTeam(db());
    const appt = await createAppointment(as(admin, T0), circle.id, { ...cardiology, kind: "in_person", transportNeeded: true });
    await expect(assignHelper(as(admin, T0), circle.id, appt.id, { role: "transport", memberId: other.family.memberId })).rejects.toMatchObject({
      code: "validation_failed",
    });
  });
});

describe("changes", () => {
  it("reschedules with optimistic concurrency and records it as a reschedule", async () => {
    const { admin, family, circle, as } = await createTeam(db());
    const appt = await createAppointment(as(admin, T0), circle.id, { ...cardiology, kind: "in_person", transportNeeded: true });
    const moved = await updateAppointment(as(family, at(1)), circle.id, appt.id, { version: 1, startsAt: hours(72) });
    expect(moved.startsAt.toISOString()).toBe(hours(72));
    await expect(updateAppointment(as(admin, T0), circle.id, appt.id, { version: 1, title: "stale" })).rejects.toMatchObject({ code: "conflict" });

    const res = await auditRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/audit`, { cookie: admin.cookie }), params({ circleId: circle.id }));
    expect((await res.json()).events[0]).toMatchObject({ action: "appointment.rescheduled", actor: { id: family.id } });
  });

  it("cancels with a reason; cancelled appointments can't be changed or completed", async () => {
    const { admin, circle, as } = await createTeam(db());
    const appt = await createAppointment(as(admin, T0), circle.id, { ...cardiology, kind: "in_person", transportNeeded: true });
    const cancelled = await cancelAppointment(as(admin, T0), circle.id, appt.id, { reason: "Doctor on leave" });
    expect(cancelled).toMatchObject({ status: "cancelled", cancelReason: "Doctor on leave" });
    await expect(updateAppointment(as(admin, T0), circle.id, appt.id, { version: 2, title: "x" })).rejects.toMatchObject({ code: "conflict" });
    await expect(completeAppointment(as(admin, at(60)), circle.id, appt.id, {})).rejects.toMatchObject({ code: "conflict" });
  });

  it("virtual appointments need no transport and validate the link and times", async () => {
    const { admin, circle, as } = await createTeam(db());
    const tele = await createAppointment(as(admin, T0), circle.id, {
      title: "Teleconsultation",
      kind: "virtual",
      virtualUrl: "https://meet.example.com/abc",
      startsAt: hours(5),
      transportNeeded: true,
    });
    expect(tele.transportNeeded).toBe(false);
    const res = await createRoute(
      apiRequest("POST", `/api/v1/circles/${circle.id}/appointments`, {
        cookie: admin.cookie,
        body: { title: "", kind: "virtual", virtualUrl: "http://insecure.example", startsAt: hours(5), endsAt: hours(4) },
      }),
      params({ circleId: circle.id }),
    );
    expect(res.status).toBe(422);
    expect(Object.keys((await res.json()).error.details).sort()).toEqual(["endsAt", "title", "virtualUrl"]);
  });

  it("lists upcoming and past separately", async () => {
    const { admin, circle, as } = await createTeam(db());
    await createAppointment(as(admin, T0), circle.id, { ...cardiology, title: "Past", startsAt: hours(-30), kind: "in_person", transportNeeded: true });
    await createAppointment(as(admin, T0), circle.id, { ...cardiology, title: "Soon", startsAt: hours(2), kind: "in_person", transportNeeded: true });
    await createAppointment(as(admin, T0), circle.id, { ...cardiology, title: "Later", startsAt: hours(200), kind: "in_person", transportNeeded: true });
    expect((await listAppointments(as(admin, T0), circle.id, { range: "upcoming" })).map((a) => a.title)).toEqual(["Soon", "Later"]);
    expect((await listAppointments(as(admin, T0), circle.id, { range: "past" })).map((a) => a.title)).toEqual(["Past"]);
  });
});

describe("permissions and privacy", () => {
  it("follows the matrix: caregivers see but don't schedule; emergency contacts see nothing", async () => {
    const { clinician, caregiver, neighbour, family, circle, as } = await createTeam(db());
    expect((await createAppointment(as(clinician, T0), circle.id, { ...cardiology, kind: "in_person", transportNeeded: true })).status).toBe("scheduled");
    expect((await createAppointment(as(family, T0), circle.id, { ...cardiology, kind: "in_person", transportNeeded: true })).status).toBe("scheduled");
    await expect(createAppointment(as(caregiver, T0), circle.id, { ...cardiology, kind: "in_person", transportNeeded: true })).rejects.toMatchObject({ code: "forbidden" });
    expect(await listAppointments(as(caregiver, T0), circle.id, { range: "upcoming" })).toHaveLength(2);
    await expect(listAppointments(as(neighbour, T0), circle.id, { range: "upcoming" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("family lose access when the parent stops sharing appointments; caregivers keep it", async () => {
    const { elder, family, caregiver, admin, circle, as } = await createTeam(db());
    await createAppointment(as(admin, T0), circle.id, { ...cardiology, kind: "in_person", transportNeeded: true });
    await putConsentFor(elder, circle.id, { shareMedications: true, shareAppointments: false, shareHealth: true });
    await expect(listAppointments(as(family, T0), circle.id, { range: "upcoming" })).rejects.toMatchObject({ code: "forbidden" });
    expect(await listAppointments(as(caregiver, T0), circle.id, { range: "upcoming" })).toHaveLength(1);
  });

  it("outsiders get 404, including when using their own circle id", async () => {
    const { admin, circle, as } = await createTeam(db());
    const appt = await createAppointment(as(admin, T0), circle.id, { ...cardiology, kind: "in_person", transportNeeded: true });
    const outsider = await signUp();
    const own = await createTestCircle(outsider);
    expect((await listRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/appointments`, { cookie: outsider.cookie }), params({ circleId: circle.id }))).status).toBe(404);
    expect(
      (await getRoute(apiRequest("GET", `/api/v1/circles/${own.id}/appointments/${appt.id}`, { cookie: outsider.cookie }), params({ circleId: own.id, appointmentId: appt.id })))
        .status,
    ).toBe(404);
    const helpers = await helpersRoute(
      apiRequest("PUT", `/api/v1/circles/${circle.id}/appointments/${appt.id}/helpers`, { cookie: outsider.cookie, body: { role: "transport", memberId: null } }),
      params({ circleId: circle.id, appointmentId: appt.id }),
    );
    expect(helpers.status).toBe(404);
  });

  it("only organisers or the person who went can record the outcome", async () => {
    const { admin, caregiver, circle, as } = await createTeam(db());
    const appt = await createAppointment(as(admin, T0), circle.id, { ...cardiology, startsAt: hours(-1), kind: "in_person", transportNeeded: true });
    await expect(completeAppointment(as(caregiver, T0), circle.id, appt.id, { outcomeNote: "x" })).rejects.toMatchObject({ code: "forbidden" });
    await assignHelper(as(caregiver, T0), circle.id, appt.id, { role: "companion", memberId: caregiver.memberId });
    expect((await completeAppointment(as(caregiver, T0), circle.id, appt.id, { outcomeNote: "Went well" })).outcome?.by).toBe("Meena");
  });
});
