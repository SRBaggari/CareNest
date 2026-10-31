import { describe, expect, it } from "vitest";
import { GET as getMyAlerts, PUT as putMyAlerts } from "@/app/api/v1/circles/[circleId]/my-alerts/route";
import { GET as getPrefs, PUT as putPrefs } from "@/app/api/v1/me/notification-preferences/route";
import { POST as ack } from "@/app/api/v1/notifications/[notificationId]/acknowledge/route";
import { POST as read } from "@/app/api/v1/notifications/[notificationId]/read/route";
import { POST as readAll } from "@/app/api/v1/notifications/read-all/route";
import { GET as list } from "@/app/api/v1/notifications/route";
import { createNotifications, type NewNotification } from "@/server/services/notifications";
import { addMember, createTestCircle } from "../helpers/circles";
import { setupTestDb } from "../helpers/db";
import { apiRequest, params } from "../helpers/http";
import { signUp, type TestUser } from "../helpers/users";

const db = setupTestDb();

function note(user: TestUser, overrides: Partial<NewNotification> = {}): NewNotification {
  return {
    userId: user.id,
    circleId: null,
    kind: "test",
    priority: "normal",
    title: "Hello",
    body: "Body",
    link: null,
    groupKey: null,
    dedupeKey: `test:${user.id}:${Math.random()}`,
    ...overrides,
  };
}

const listFor = async (user: TestUser, query = "") =>
  (await list(apiRequest("GET", `/api/v1/notifications${query}`, { cookie: user.cookie }))).json();

describe("in-app notifications", () => {
  it("are created idempotently by dedupe key", async () => {
    const user = await signUp();
    const n = note(user, { dedupeKey: "dose_unconfirmed:abc:user" });
    expect(await createNotifications(db(), [n], new Date())).toHaveLength(1);
    expect(await createNotifications(db(), [n], new Date())).toHaveLength(0);
    const body = await listFor(user);
    expect(body.notifications).toHaveLength(1);
    expect(body.unreadCount).toBe(1);
    expect(body.notifications[0]).not.toHaveProperty("dedupeKey");
  });

  it("each user sees only their own, and cannot read or acknowledge someone else's", async () => {
    const a = await signUp();
    const b = await signUp();
    const [mine] = await createNotifications(db(), [note(a)], new Date());
    await createNotifications(db(), [note(b)], new Date());
    expect((await listFor(a)).notifications).toHaveLength(1);
    const p = params({ notificationId: mine.id });
    expect((await read(apiRequest("POST", `/api/v1/notifications/${mine.id}/read`, { cookie: b.cookie }), p)).status).toBe(404);
    expect((await ack(apiRequest("POST", `/api/v1/notifications/${mine.id}/acknowledge`, { cookie: b.cookie }), p)).status).toBe(404);
    expect((await list(apiRequest("GET", "/api/v1/notifications"))).status).toBe(401);
  });

  it("marks one or all as read and filters unread", async () => {
    const user = await signUp();
    const [first] = await createNotifications(db(), [note(user), note(user), note(user)], new Date());
    await read(apiRequest("POST", `/api/v1/notifications/${first.id}/read`, { cookie: user.cookie }), params({ notificationId: first.id }));
    expect((await listFor(user)).unreadCount).toBe(2);
    expect((await listFor(user, "?unread=true")).notifications).toHaveLength(2);
    await readAll(apiRequest("POST", "/api/v1/notifications/read-all", { cookie: user.cookie }));
    expect((await listFor(user)).unreadCount).toBe(0);
  });

  it("shows everyone in the group who is already checking on it", async () => {
    const priya = await signUp({ name: "Priya" });
    const ravi = await signUp({ name: "Ravi" });
    const group = "dose:1234";
    const [, raviNote] = await createNotifications(
      db(),
      [note(priya, { groupKey: group, priority: "high" }), note(ravi, { groupKey: group, priority: "high" })],
      new Date(),
    );
    const res = await ack(apiRequest("POST", `/api/v1/notifications/${raviNote.id}/acknowledge`, { cookie: ravi.cookie }), params({ notificationId: raviNote.id }));
    expect(res.status).toBe(204);
    const priyaView = await listFor(priya);
    expect(priyaView.notifications[0].acknowledgedBy.map((a: { name: string }) => a.name)).toEqual(["Ravi"]);
    const raviView = await listFor(ravi);
    expect(raviView.notifications[0].readAt).not.toBeNull();
  });
});

describe("notification preferences", () => {
  it("defaults to email on and no quiet hours, and can be changed", async () => {
    const user = await signUp();
    const initial = await (await getPrefs(apiRequest("GET", "/api/v1/me/notification-preferences", { cookie: user.cookie }))).json();
    expect(initial.preferences).toEqual({ emailEnabled: true, quietStart: null, quietEnd: null });
    const res = await putPrefs(
      apiRequest("PUT", "/api/v1/me/notification-preferences", { cookie: user.cookie, body: { emailEnabled: false, quietStart: "22:00", quietEnd: "07:00" } }),
    );
    expect((await res.json()).preferences).toEqual({ emailEnabled: false, quietStart: "22:00", quietEnd: "07:00" });
  });

  it("requires both quiet-hour ends and valid times", async () => {
    const user = await signUp();
    const res = await putPrefs(
      apiRequest("PUT", "/api/v1/me/notification-preferences", { cookie: user.cookie, body: { emailEnabled: true, quietStart: "10pm", quietEnd: null } }),
    );
    expect(res.status).toBe(422);
    expect(Object.keys((await res.json()).error.details).sort()).toEqual(["quietEnd", "quietStart"]);
    const half = await putPrefs(
      apiRequest("PUT", "/api/v1/me/notification-preferences", { cookie: user.cookie, body: { emailEnabled: true, quietStart: "22:00", quietEnd: null } }),
    );
    expect((await half.json()).error.details).toHaveProperty("quietEnd");
  });
});

describe("per-circle alert choices", () => {
  it("start from role defaults and can be changed by the member for themselves", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const caregiver = await signUp();
    await addMember(db(), circle.id, caregiver, "caregiver");
    const p = params({ circleId: circle.id });
    const url = `/api/v1/circles/${circle.id}/my-alerts`;

    const defaults = await (await getMyAlerts(apiRequest("GET", url, { cookie: caregiver.cookie }), p)).json();
    expect(defaults).toEqual({ settings: { doseReminders: true, unconfirmedDoses: true, refills: true }, canReceiveMedicationAlerts: true });

    const res = await putMyAlerts(apiRequest("PUT", url, { cookie: caregiver.cookie, body: { refills: false } }), p);
    expect((await res.json()).settings).toEqual({ doseReminders: true, unconfirmedDoses: true, refills: false });

    const ownerView = await (await getMyAlerts(apiRequest("GET", url, { cookie: owner.cookie }), p)).json();
    expect(ownerView.settings).toEqual({ doseReminders: false, unconfirmedDoses: true, refills: true });
  });

  it("is 404 for non-members", async () => {
    const owner = await signUp();
    const circle = await createTestCircle(owner);
    const outsider = await signUp();
    const res = await getMyAlerts(apiRequest("GET", `/api/v1/circles/${circle.id}/my-alerts`, { cookie: outsider.cookie }), params({ circleId: circle.id }));
    expect(res.status).toBe(404);
  });
});
