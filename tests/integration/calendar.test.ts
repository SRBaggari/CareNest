import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as calendarFile } from "@/app/api/calendar/[token]/route";
import { DELETE as stopFeed, GET as feedStatus, POST as makeFeed } from "@/app/api/v1/circles/[circleId]/calendar-feed/route";
import { calendarFeeds, users } from "@/server/db/schema";
import { cancelAppointment, createAppointment } from "@/server/services/appointments";
import { removeMember } from "@/server/services/members";
import { createTask } from "@/server/services/tasks";
import { createVisit } from "@/server/services/visits";
import { createTeam } from "../helpers/circles";
import { putConsentFor } from "../helpers/consent";
import { setupTestDb } from "../helpers/db";
import { apiRequest, params } from "../helpers/http";
import type { TestUser } from "../helpers/users";

const db = setupTestDb();
const soon = (hours: number) => new Date(Date.now() + hours * 3_600_000);

async function linkFor(user: TestUser, circleId: string) {
  const res = await makeFeed(apiRequest("POST", `/api/v1/circles/${circleId}/calendar-feed`, { cookie: user.cookie }), params({ circleId }));
  expect(res.status).toBe(201);
  const { feed } = await res.json();
  expect(feed.webcalUrl.startsWith("webcal://")).toBe(true);
  return feed.url as string;
}

/** Fetches a calendar link the way a calendar app does: no cookies, no Origin. */
async function fetchCalendar(url: string) {
  const token = url.split("/api/calendar/")[1];
  const res = await calendarFile(new Request(url, { method: "GET" }), params({ token }));
  return { status: res.status, type: res.headers.get("content-type"), text: await res.text() };
}

async function family() {
  const team = await createTeam(db());
  const now = new Date();
  const appt = await createAppointment(team.as(team.admin, now), team.circle.id, {
    title: "Cardiology check-up",
    kind: "in_person",
    transportNeeded: true,
    location: "Apollo, Jubilee Hills",
    reason: "Chest pain on stairs",
    questions: "Should the dose change?",
    startsAt: soon(26).toISOString(),
  });
  const cancelled = await createAppointment(team.as(team.admin, now), team.circle.id, { title: "Eye test", kind: "in_person", transportNeeded: true, startsAt: soon(50).toISOString() });
  await cancelAppointment(team.as(team.admin, now), team.circle.id, cancelled.id, { reason: "Doctor away" });
  await createVisit(team.as(team.caregiver, now), team.circle.id, { plannedStart: soon(5).toISOString(), purpose: "Morning care" });
  await createTask(team.as(team.admin, now), team.circle.id, { title: "Buy BP tablets", dueAt: soon(30).toISOString(), assigneeMemberId: team.family.memberId });
  await createTask(team.as(team.admin, now), team.circle.id, { title: "Pay the bill", dueAt: soon(30).toISOString(), assigneeMemberId: team.caregiver.memberId });
  return { ...team, appt, cancelled };
}

describe("private calendar links", () => {
  it("give a calendar app this person's appointments, visits and own tasks, without the private details", async () => {
    const team = await family();
    const calendar = await fetchCalendar(await linkFor(team.family, team.circle.id));
    expect(calendar.status).toBe(200);
    expect(calendar.type).toBe("text/calendar; charset=utf-8");
    expect(calendar.text).toContain("SUMMARY:Cardiology check-up · Amma");
    expect(calendar.text).toContain("LOCATION:Apollo\\, Jubilee Hills");
    expect(calendar.text).toContain(`UID:appointment-${team.appt.id}@carenest`);
    expect(calendar.text.split(`UID:appointment-${team.cancelled.id}@carenest`)[1].split("END:VEVENT")[0]).toContain("STATUS:CANCELLED");
    expect(calendar.text).toContain("SUMMARY:Meena visits Amma");
    expect(calendar.text).toContain("SUMMARY:Task: Buy BP tablets");
    expect(calendar.text).not.toContain("Pay the bill"); // someone else's task
    // Calendar apps copy events to their servers: no reasons, questions or notes.
    for (const secret of ["Chest pain", "dose change", "Doctor away", "Morning care"]) expect(calendar.text).not.toContain(secret);
  });

  it("follows the parent's choice not to share appointments with family", async () => {
    const team = await family();
    const familyUrl = await linkFor(team.family, team.circle.id);
    const caregiverUrl = await linkFor(team.caregiver, team.circle.id);
    await putConsentFor(team.elder, team.circle.id, { shareMedications: true, shareAppointments: false, shareHealth: true });
    expect((await fetchCalendar(familyUrl)).text).not.toContain("Cardiology");
    expect((await fetchCalendar(caregiverUrl)).text).toContain("Cardiology");
  });

  it("only ever contains the link owner's own circle", async () => {
    const mine = await family();
    const theirs = await createTeam(db());
    await createAppointment(theirs.as(theirs.admin, new Date()), theirs.circle.id, { title: "Zebra clinic", kind: "in_person", transportNeeded: true, startsAt: soon(20).toISOString() });
    expect((await fetchCalendar(await linkFor(mine.family, mine.circle.id))).text).not.toContain("Zebra");
  });

  it("stops working when revoked, replaced, or when the person leaves the circle", async () => {
    const team = await family();
    const p = params({ circleId: team.circle.id });
    const first = await linkFor(team.family, team.circle.id);
    const second = await linkFor(team.family, team.circle.id);
    expect((await fetchCalendar(first)).status).toBe(404);
    expect((await fetchCalendar(second)).status).toBe(200);

    expect((await stopFeed(apiRequest("DELETE", `/api/v1/circles/${team.circle.id}/calendar-feed`, { cookie: team.family.cookie }), p)).status).toBe(204);
    expect((await fetchCalendar(second)).status).toBe(404);

    const caregiverUrl = await linkFor(team.caregiver, team.circle.id);
    await removeMember(team.as(team.admin, new Date()), team.circle.id, team.caregiver.memberId);
    expect((await fetchCalendar(caregiverUrl)).status).toBe(404);
  });

  it("answers made-up links with the same plain 404", async () => {
    for (const token of ["nope.ics", "a".repeat(43) + ".ics", "../../etc/passwd", "x".repeat(500)]) {
      const res = await calendarFile(new Request(`http://localhost/api/calendar/${encodeURIComponent(token)}`), params({ token }));
      expect([token.slice(0, 12), res.status]).toEqual([token.slice(0, 12), 404]);
    }
  });

  it("records when the calendar app last fetched it, and shows the person only that, never the link", async () => {
    const team = await family();
    const p = params({ circleId: team.circle.id });
    const statusOf = async () => (await (await feedStatus(apiRequest("GET", `/api/v1/circles/${team.circle.id}/calendar-feed`, { cookie: team.family.cookie }), p)).json()).feed;
    expect(await statusOf()).toEqual({ active: false });
    const url = await linkFor(team.family, team.circle.id);
    expect((await statusOf()).lastFetchedAt).toBeNull();
    await fetchCalendar(url);
    const status = await statusOf();
    expect(status.lastFetchedAt).not.toBeNull();
    expect(JSON.stringify(status)).not.toContain(url.split("/").pop()!.replace(".ics", ""));
    const [row] = await db().select().from(calendarFeeds).where(eq(calendarFeeds.userId, team.family.id));
    expect(row.tokenHash).not.toContain(url.split("/").pop()!.replace(".ics", ""));
  });

  it("is written in the person's own language", async () => {
    const team = await family();
    await db().update(users).set({ locale: "te" }).where(eq(users.id, team.family.id));
    expect((await fetchCalendar(await linkFor(team.family, team.circle.id))).text).toContain("SUMMARY:Meena Ammaను చూడటానికి వస్తారు");
  });

  it("needs sign-in and membership to make or see a link", async () => {
    const team = await createTeam(db());
    const outsider = await createTeam(db());
    const p = params({ circleId: team.circle.id });
    expect((await makeFeed(apiRequest("POST", `/api/v1/circles/${team.circle.id}/calendar-feed`), p)).status).toBe(401);
    expect((await makeFeed(apiRequest("POST", `/api/v1/circles/${team.circle.id}/calendar-feed`, { cookie: outsider.admin.cookie }), p)).status).toBe(404);
    expect((await feedStatus(apiRequest("GET", `/api/v1/circles/${team.circle.id}/calendar-feed`, { cookie: outsider.admin.cookie }), p)).status).toBe(404);
  });
});
