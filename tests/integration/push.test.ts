import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as getConfig } from "@/app/api/v1/push/route";
import { DELETE as removeByEndpoint, GET as listDevices, POST as addDevice } from "@/app/api/v1/me/push-devices/route";
import { DELETE as removeDevice } from "@/app/api/v1/me/push-devices/[deviceId]/route";
import { POST as testPush } from "@/app/api/v1/me/push-devices/test/route";
import { pushOutbox, pushSubscriptions, users } from "@/server/db/schema";
import { setPushTransportForTesting } from "@/server/notifications/push";
import { deleteMyAccount, exportMyData } from "@/server/services/data-rights";
import { raiseAssistance } from "@/server/services/assistance";
import { updatePreferences } from "@/server/services/notifications";
import { postUpdate } from "@/server/services/updates";
import { runTick } from "@/server/worker/tick";
import { createTeam } from "../helpers/circles";
import { setupTestDb } from "../helpers/db";
import { setupFakeEmail } from "../helpers/email";
import { apiRequest, params } from "../helpers/http";
import { browserSubscription, setupFakePush } from "../helpers/push";
import { signUp, TEST_PASSWORD, type TestUser } from "../helpers/users";

const db = setupTestDb();
setupFakeEmail();
const push = setupFakePush();
const at = (time: string) => new Date(`2026-11-14T${time}:00Z`);

async function turnOnAlerts(user: TestUser, sub = browserSubscription()) {
  const res = await addDevice(apiRequest("POST", "/api/v1/me/push-devices", { cookie: user.cookie, body: sub }));
  expect(res.status).toBe(201);
  return { ...sub, id: (await res.json()).device.id as string };
}

describe("turning phone alerts on and off", () => {
  it("reports whether the server can send alerts, to signed-in people only", async () => {
    const user = await signUp();
    expect(await (await getConfig(apiRequest("GET", "/api/v1/push", { cookie: user.cookie }))).json()).toEqual({ enabled: true, publicKey: "test-public-key" });
    expect((await getConfig(apiRequest("GET", "/api/v1/push"))).status).toBe(401);
    setPushTransportForTesting(null);
    expect((await (await getConfig(apiRequest("GET", "/api/v1/push", { cookie: user.cookie }))).json()).enabled).toBe(false);
    const off = await addDevice(apiRequest("POST", "/api/v1/me/push-devices", { cookie: user.cookie, body: browserSubscription() }));
    expect(off.status).toBe(409);
  });

  it("saves a browser's subscription and lists it; needs sign-in", async () => {
    const user = await signUp();
    await turnOnAlerts(user, browserSubscription("Chrome · Android"));
    const { devices } = await (await listDevices(apiRequest("GET", "/api/v1/me/push-devices", { cookie: user.cookie }))).json();
    expect(devices).toEqual([expect.objectContaining({ label: "Chrome · Android", lastSuccessAt: null })]);
    expect((await addDevice(apiRequest("POST", "/api/v1/me/push-devices", { body: browserSubscription() }))).status).toBe(401);
    expect((await listDevices(apiRequest("GET", "/api/v1/me/push-devices"))).status).toBe(401);
  });

  it("refuses push addresses that aren't real push services, and malformed keys", async () => {
    const user = await signUp();
    for (const endpoint of ["https://169.254.169.254/latest/meta-data", "https://evil.example/x", "http://fcm.googleapis.com/fcm/send/x"]) {
      const res = await addDevice(apiRequest("POST", "/api/v1/me/push-devices", { cookie: user.cookie, body: { ...browserSubscription(), endpoint } }));
      expect([endpoint, res.status]).toEqual([endpoint, 422]);
    }
    const badKeys = await addDevice(apiRequest("POST", "/api/v1/me/push-devices", { cookie: user.cookie, body: { ...browserSubscription(), keys: { p256dh: "short", auth: "<script>" } } }));
    expect(badKeys.status).toBe(422);
    expect(await db().select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id))).toEqual([]);
  });

  it("limits devices per person, and moves a browser to whoever signs in on it next", async () => {
    const a = await signUp();
    for (let i = 0; i < 10; i++) await turnOnAlerts(a);
    const eleventh = await addDevice(apiRequest("POST", "/api/v1/me/push-devices", { cookie: a.cookie, body: browserSubscription() }));
    expect(eleventh.status).toBe(409);

    const shared = browserSubscription("Family tablet");
    const b = await signUp();
    const c = await signUp();
    await turnOnAlerts(b, shared);
    await turnOnAlerts(c, shared);
    const [row] = await db().select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, shared.endpoint));
    expect(row.userId).toBe(c.id);
  });

  it("lets people remove only their own devices", async () => {
    const owner = await signUp();
    const other = await signUp();
    const device = await turnOnAlerts(owner);
    const p = params({ deviceId: device.id });
    expect((await removeDevice(apiRequest("DELETE", `/api/v1/me/push-devices/${device.id}`, { cookie: other.cookie }), p)).status).toBe(404);
    expect((await removeDevice(apiRequest("DELETE", "/api/v1/me/push-devices/not-a-uuid", { cookie: owner.cookie }), params({ deviceId: "not-a-uuid" }))).status).toBe(404);
    await removeByEndpoint(apiRequest("DELETE", `/api/v1/me/push-devices?endpoint=${encodeURIComponent(device.endpoint)}`, { cookie: other.cookie }));
    expect(await db().select().from(pushSubscriptions).where(eq(pushSubscriptions.id, device.id))).toHaveLength(1);
    expect((await removeDevice(apiRequest("DELETE", `/api/v1/me/push-devices/${device.id}`), p)).status).toBe(401);
    expect((await removeDevice(apiRequest("DELETE", `/api/v1/me/push-devices/${device.id}`, { cookie: owner.cookie }), p)).status).toBe(204);
  });

  it("sends a test alert to the person's devices straight away", async () => {
    const user = await signUp();
    expect((await testPush(apiRequest("POST", "/api/v1/me/push-devices/test", { cookie: user.cookie }))).status).toBe(409);
    await turnOnAlerts(user);
    expect((await testPush(apiRequest("POST", "/api/v1/me/push-devices/test", { cookie: user.cookie }))).status).toBe(200);
    expect(push().sent.map((s) => s.payload.title)).toEqual(["CareNest test alert"]);
  });
});

describe("what reaches the phone", () => {
  it("buzzes for important news with the title only, never the details; everyday news waits for the digest", async () => {
    const team = await createTeam(db());
    await turnOnAlerts(team.family);
    await postUpdate(team.as(team.elder, at("09:00")), team.circle.id, { body: "Amma feels dizzy after the new tablet.", important: true });
    await postUpdate(team.as(team.elder, at("09:05")), team.circle.id, { body: "Had lunch." });
    await runTick(db(), at("09:06"));
    expect(push().sent).toHaveLength(1);
    const [{ payload }] = push().sent;
    expect(payload).toMatchObject({ title: "Important update from Amma", body: "Open CareNest to see details.", link: `/app/circles/${team.circle.id}/updates`, urgent: false });
    expect(JSON.stringify(payload)).not.toContain("dizzy");
    // Delivered alerts don't keep their content around.
    expect((await db().select().from(pushOutbox)).every((r) => r.payload === null)).toBe(true);
  });

  it("holds alerts during quiet hours, except a request for help, which goes first and stays on screen", async () => {
    const team = await createTeam(db());
    await turnOnAlerts(team.family);
    await updatePreferences(team.as(team.family, at("08:00")), { emailEnabled: true, quietStart: "21:00", quietEnd: "07:00" });
    await postUpdate(team.as(team.elder, at("22:00")), team.circle.id, { body: "Can't sleep.", important: true });
    await raiseAssistance(team.as(team.elder, at("22:01")), team.circle.id, { message: "I fell" });
    await runTick(db(), at("22:02"));
    // Only the request for help gets through tonight, marked urgent so it stays on screen.
    expect(push().sent.map((s) => s.payload.urgent)).toEqual([true]);
    const held = (title: string) => push().sent.some((s) => s.payload.title === title);
    expect(held("Important update from Amma")).toBe(false);
    await runTick(db(), new Date("2026-11-15T07:01:00Z"));
    expect(held("Important update from Amma")).toBe(true);
  });

  it("writes the alert in each person's own language", async () => {
    const team = await createTeam(db());
    await db().update(users).set({ locale: "te" }).where(eq(users.id, team.family.id));
    await turnOnAlerts(team.family);
    await postUpdate(team.as(team.elder, at("09:00")), team.circle.id, { body: "Not well.", important: true });
    await runTick(db(), at("09:01"));
    expect(push().sent[0].payload.body).toBe("వివరాలు చూడటానికి CareNest తెరవండి.");
  });

  it("forgets a device the push service says is gone", async () => {
    const team = await createTeam(db());
    const gone = await turnOnAlerts(team.family);
    push().failNext = [410];
    await postUpdate(team.as(team.elder, at("09:00")), team.circle.id, { body: "Not well.", important: true });
    await runTick(db(), at("09:01"));
    expect(await db().select().from(pushSubscriptions).where(eq(pushSubscriptions.id, gone.id))).toEqual([]);
    expect(push().sent).toHaveLength(0);
  });

  it("retries a temporary failure a minute later, then records the delivery", async () => {
    const team = await createTeam(db());
    await turnOnAlerts(team.admin);
    push().failNext = [503];
    await postUpdate(team.as(team.elder, at("09:00")), team.circle.id, { body: "Not well.", important: true });
    await runTick(db(), at("09:01"));
    expect(push().sent).toHaveLength(0);
    await runTick(db(), at("09:01"));
    expect(push().sent).toHaveLength(0); // not before the backoff
    await runTick(db(), at("09:03"));
    expect(push().sent).toHaveLength(1);
    expect((await db().select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, team.admin.id)))[0].lastSuccessAt).not.toBeNull();
  });

  it("never sends one family's alerts to a device of someone outside the circle", async () => {
    const team = await createTeam(db());
    const outsider = await signUp();
    await turnOnAlerts(outsider);
    await postUpdate(team.as(team.elder, at("09:00")), team.circle.id, { body: "Not well.", important: true });
    await runTick(db(), at("09:01"));
    const outsiderDevices = await db().select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, outsider.id));
    expect(push().sent.filter((s) => s.target.endpoint === outsiderDevices[0].endpoint)).toEqual([]);
  });
});

describe("phone alert devices and personal data", () => {
  it("appear in 'Download my data' and are deleted with the account", async () => {
    const user = await signUp();
    await turnOnAlerts(user, browserSubscription("Firefox · Windows"));
    const data = await exportMyData({ db: db(), now: at("09:00"), userId: user.id });
    expect(data.phoneAlertDevices).toEqual([expect.objectContaining({ label: "Firefox · Windows" })]);
    expect(JSON.stringify(data)).not.toContain("fcm.googleapis.com");
    await deleteMyAccount({ db: db(), now: at("09:00"), userId: user.id }, { password: TEST_PASSWORD, confirm: "DELETE" });
    expect(await db().select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id))).toEqual([]);
  });
});
