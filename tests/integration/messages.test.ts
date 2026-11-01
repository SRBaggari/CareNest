import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DELETE as removeRoute } from "@/app/api/v1/circles/[circleId]/messages/[messageId]/route";
import { GET as threadRoute, POST as replyRoute } from "@/app/api/v1/circles/[circleId]/threads/[threadId]/route";
import { POST as forSubjectRoute } from "@/app/api/v1/circles/[circleId]/threads/for-subject/route";
import { GET as listRoute, POST as startRoute } from "@/app/api/v1/circles/[circleId]/threads/route";
import { messages, messageThreads, notifications } from "@/server/db/schema";
import { createAppointment } from "@/server/services/appointments";
import { runTick } from "@/server/worker/tick";
import { createTeam } from "../helpers/circles";
import { putConsentFor } from "../helpers/consent";
import { setupTestDb } from "../helpers/db";
import { setupFakeEmail } from "../helpers/email";
import { apiRequest, params } from "../helpers/http";
import type { TestUser } from "../helpers/users";

const db = setupTestDb();
const email = setupFakeEmail();

const start = (user: TestUser | null, circleId: string, body: unknown) =>
  startRoute(apiRequest("POST", `/api/v1/circles/${circleId}/threads`, { cookie: user?.cookie, body }), params({ circleId }));
const list = async (user: TestUser, circleId: string) =>
  (await (await listRoute(apiRequest("GET", `/api/v1/circles/${circleId}/threads`, { cookie: user.cookie }), params({ circleId }))).json()).threads;
const open = (user: TestUser, circleId: string, threadId: string) =>
  threadRoute(apiRequest("GET", `/api/v1/circles/${circleId}/threads/${threadId}`, { cookie: user.cookie }), params({ circleId, threadId }));
const reply = (user: TestUser, circleId: string, threadId: string, body: unknown) =>
  replyRoute(apiRequest("POST", `/api/v1/circles/${circleId}/threads/${threadId}`, { cookie: user.cookie, body }), params({ circleId, threadId }));
const inbox = async (user: { id: string }) => db().select().from(notifications).where(eq(notifications.userId, user.id));

describe("circle conversations", () => {
  it("starts a conversation, shows unread replies, and marks them read on opening", async () => {
    const team = await createTeam(db());
    const res = await start(team.admin, team.circle.id, { title: "Diwali visit plans", body: "Who is coming on the 12th?" });
    expect(res.status).toBe(201);
    const { thread } = await res.json();
    expect((await reply(team.family, team.circle.id, thread.id, { body: "Ravi and kids, by train." })).status).toBe(201);

    const [summary] = await list(team.admin, team.circle.id);
    expect(summary).toMatchObject({ title: "Diwali visit plans", unread: 1, last: { author: "Ravi", preview: "Ravi and kids, by train." } });
    const opened = await (await open(team.admin, team.circle.id, thread.id)).json();
    expect(opened.thread.messages.map((m: { body: string }) => m.body)).toEqual(["Who is coming on the 12th?", "Ravi and kids, by train."]);
    expect((await list(team.admin, team.circle.id))[0].unread).toBe(0);
    // My own messages never count as unread for me.
    expect((await list(team.family, team.circle.id))[0].unread).toBe(0);
  });

  it("alerts the people chosen, and gives others in the conversation quiet news, never the message in email", async () => {
    const team = await createTeam(db());
    const { thread } = await (await start(team.admin, team.circle.id, { title: "Pharmacy", body: "Who can pick up the tablets?", notify: [team.caregiver.memberId] })).json();
    const [alert] = (await inbox(team.caregiver)).filter((n) => n.kind === "message_for_you");
    expect(alert).toMatchObject({ priority: "normal", title: "Priya wants you to read “Pharmacy”" });
    expect((await inbox(team.family)).filter((n) => n.kind.startsWith("message"))).toEqual([]); // not in the conversation yet

    await reply(team.family, team.circle.id, thread.id, { body: "I can, after work." });
    const quiet = (await inbox(team.admin)).filter((n) => n.kind === "message");
    expect(quiet).toEqual([expect.objectContaining({ priority: "low", title: "Ravi wrote in “Pharmacy”" })]);

    await runTick(db(), new Date());
    const mail = email().sent.find((m) => m.to === team.caregiver.email);
    expect(mail?.subject).toBe("Priya sent you a message in CareNest");
    expect(mail?.text).not.toContain("tablets");
  });

  it("refuses to alert people who can't read the conversation, and leaves nothing behind", async () => {
    const team = await createTeam(db());
    const res = await start(team.admin, team.circle.id, { title: "Plans", body: "Hello", notify: [team.neighbour.memberId] });
    expect(res.status).toBe(422);
    expect((await res.json()).error.details).toHaveProperty("notify");
    expect(await db().select().from(messageThreads).where(eq(messageThreads.circleId, team.circle.id))).toEqual([]);
  });

  it("keeps one conversation per appointment, following the parent's choice to share appointments", async () => {
    const team = await createTeam(db());
    const appt = await createAppointment(team.as(team.admin, new Date()), team.circle.id, { title: "Cardiology", kind: "in_person", transportNeeded: true, startsAt: new Date(Date.now() + 86_400_000).toISOString() });
    const subject = (user: TestUser) =>
      forSubjectRoute(apiRequest("POST", `/api/v1/circles/${team.circle.id}/threads/for-subject`, { cookie: user.cookie, body: { subjectType: "appointment", subjectId: appt.id } }), params({ circleId: team.circle.id }));
    const first = (await (await subject(team.family)).json()).thread.id;
    expect((await (await subject(team.caregiver)).json()).thread.id).toBe(first);
    await reply(team.family, team.circle.id, first, { body: "I'll drive." });
    expect((await list(team.admin, team.circle.id))[0]).toMatchObject({ title: "Cardiology", subjectType: "appointment" });

    await putConsentFor(team.elder, team.circle.id, { shareMedications: true, shareAppointments: false, shareHealth: true });
    expect(await list(team.family, team.circle.id)).toEqual([]);
    expect((await open(team.family, team.circle.id, first)).status).toBe(404);
    expect((await subject(team.family)).status).toBe(403);
    expect((await list(team.caregiver, team.circle.id))).toHaveLength(1);
  });

  it("is closed to emergency contacts, outsiders and signed-out visitors, and never mixes two families", async () => {
    const team = await createTeam(db());
    const other = await createTeam(db());
    const { thread } = await (await start(team.admin, team.circle.id, { title: "Private", body: "Family only" })).json();
    await start(other.admin, other.circle.id, { title: "Zebra plans", body: "Zebra" });
    expect((await listRoute(apiRequest("GET", `/api/v1/circles/${team.circle.id}/threads`, { cookie: team.neighbour.cookie }), params({ circleId: team.circle.id }))).status).toBe(403);
    expect((await open(other.admin, team.circle.id, thread.id)).status).toBe(404);
    expect((await open(other.admin, other.circle.id, thread.id)).status).toBe(404);
    expect((await reply(other.admin, team.circle.id, thread.id, { body: "hi" })).status).toBe(404);
    expect((await start(null, team.circle.id, { title: "x", body: "y" })).status).toBe(401);
    expect(JSON.stringify(await list(team.admin, team.circle.id))).not.toContain("Zebra");
  });

  it("lets authors take back their own messages only", async () => {
    const team = await createTeam(db());
    const { thread } = await (await start(team.admin, team.circle.id, { title: "Plans", body: "Wrong date, sorry" })).json();
    const [mine] = await db().select().from(messages).where(and(eq(messages.threadId, thread.id)));
    const remove = (user: TestUser) =>
      removeRoute(apiRequest("DELETE", `/api/v1/circles/${team.circle.id}/messages/${mine.id}`, { cookie: user.cookie }), params({ circleId: team.circle.id, messageId: mine.id }));
    expect((await remove(team.family)).status).toBe(403);
    expect((await remove(team.admin)).status).toBe(204);
    const opened = await (await open(team.family, team.circle.id, thread.id)).json();
    expect(opened.thread.messages[0]).toMatchObject({ body: null, removedAt: expect.any(String) });
    expect((await list(team.family, team.circle.id))[0].last.preview).toBeNull();
  });
});

describe("conversations in data exports", () => {
  it("are in my data and the circle export, with appointment conversations following the sharing choice", async () => {
    const { exportCircle, exportMyData } = await import("@/server/services/data-rights");
    const team = await createTeam(db());
    await start(team.admin, team.circle.id, { title: "Diwali visit plans", body: "Who is coming?" });
    const appt = await createAppointment(team.as(team.admin, new Date()), team.circle.id, { title: "Cardiology", kind: "in_person", transportNeeded: true, startsAt: new Date(Date.now() + 86_400_000).toISOString() });
    const { thread } = await (await forSubjectRoute(apiRequest("POST", `/api/v1/circles/${team.circle.id}/threads/for-subject`, { cookie: team.admin.cookie, body: { subjectType: "appointment", subjectId: appt.id } }), params({ circleId: team.circle.id }))).json();
    await reply(team.admin, team.circle.id, thread.id, { body: "I'll drive." });

    const mine = await exportMyData(team.as(team.admin, new Date()));
    expect(mine.messagesIWrote.map((m) => m.body).sort()).toEqual(["I'll drive.", "Who is coming?"]);
    const full = await exportCircle(team.as(team.admin, new Date()), team.circle.id);
    expect(full.conversations.map((c) => c.title).sort()).toEqual(["Cardiology", "Diwali visit plans"]);

    await putConsentFor(team.elder, team.circle.id, { shareMedications: true, shareAppointments: false, shareHealth: true });
    const limited = await exportCircle(team.as(team.admin, new Date()), team.circle.id);
    expect(limited.conversations.map((c) => c.title)).toEqual(["Diwali visit plans"]);
  });
});
