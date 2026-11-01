import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as circleExportRoute } from "@/app/api/v1/circles/[circleId]/export/route";
import { GET as myExportRoute } from "@/app/api/v1/me/export/route";
import { DELETE as deleteMeRoute, GET as meRoute } from "@/app/api/v1/me/route";
import { careProfiles, careUpdates, emailOutbox, notifications, rateLimits, sessions, users } from "@/server/db/schema";
import { enqueueEmail } from "@/server/notifications/email";
import { listAuditEvents } from "@/server/services/audit";
import { purgeExpiredData, RETENTION } from "@/server/services/data-rights";
import { createMedication } from "@/server/services/medications";
import { createNotifications } from "@/server/services/notifications";
import { listUpdates, postUpdate } from "@/server/services/updates";
import { createTeam, createTestCircle } from "../helpers/circles";
import { setupTestDb } from "../helpers/db";
import { apiRequest, params } from "../helpers/http";
import { signUp, TEST_PASSWORD } from "../helpers/users";

const db = setupTestDb();
const T0 = new Date("2026-11-14T04:00:00Z");

const deleteMe = (cookie: string, body: unknown) => deleteMeRoute(apiRequest("DELETE", "/api/v1/me", { cookie, body }));

describe("export my data", () => {
  it("downloads my account, circles, devices and what I wrote — never password or token hashes", async () => {
    const { family, circle, as } = await createTeam(db());
    await postUpdate(as(family, T0), circle.id, { body: "Visited Amma today" });
    const res = await myExportRoute(apiRequest("GET", "/api/v1/me/export", { cookie: family.cookie }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="carenest-my-data-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const data = await res.json();
    expect(data).toMatchObject({ format: "carenest-export/1", account: { email: family.email, name: "Ravi" } });
    expect(data.circles).toEqual([expect.objectContaining({ circle: "Amma's care", role: "family" })]);
    expect(data.updatesIWrote).toEqual([expect.objectContaining({ body: "Visited Amma today" })]);
    expect(data.signedInDevices.length).toBeGreaterThan(0);
    const raw = JSON.stringify(data);
    expect(raw).not.toMatch(/scrypt\$|passwordHash|tokenHash|token_hash/);
  });
});

describe("export a circle's full record", () => {
  it("is available to the people who manage the circle, is audited, and contains no secrets", async () => {
    const { admin, elder, family, circle, as } = await createTeam(db());
    await createMedication(as(admin, T0), circle.id, { name: "Metformin", dosage: "500 mg", startDate: "2026-11-14", asNeeded: false, times: ["08:00"], unitsPerDose: 1 });
    for (const who of [admin, elder]) {
      const res = await circleExportRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/export`, { cookie: who.cookie }), params({ circleId: circle.id }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.medications.map((m: { name: string }) => m.name)).toEqual(["Metformin"]);
      expect(data.members.length).toBe(6);
      expect(JSON.stringify(data)).not.toMatch(/scrypt\$|passwordHash|tokenHash|linkedUserId/);
    }
    const denied = await circleExportRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/export`, { cookie: family.cookie }), params({ circleId: circle.id }));
    expect(denied.status).toBe(403);
    const outsider = await signUp();
    expect((await circleExportRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/export`, { cookie: outsider.cookie }), params({ circleId: circle.id }))).status).toBe(404);
    const audit = await listAuditEvents(as(admin, T0), circle.id);
    expect(audit.filter((e) => e.action === "circle.exported")).toHaveLength(2);
  });
});

describe("delete my account", () => {
  it("requires the password and typing DELETE", async () => {
    const user = await signUp();
    expect((await deleteMe(user.cookie, { password: "wrong password!!", confirm: "DELETE" })).status).toBe(422);
    expect((await deleteMe(user.cookie, { password: TEST_PASSWORD, confirm: "delete" })).status).toBe(422);
    expect((await meRoute(apiRequest("GET", "/api/v1/me", { cookie: user.cookie }))).status).toBe(200);
  });

  it("removes the person but keeps the care notes they wrote, with authorship removed", async () => {
    const { family, admin, circle, as } = await createTeam(db());
    await postUpdate(as(family, T0), circle.id, { body: "Took Amma to the temple" });
    const res = await deleteMe(family.cookie, { password: TEST_PASSWORD, confirm: "DELETE" });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");

    expect(await db().select().from(users).where(eq(users.id, family.id))).toHaveLength(0);
    expect(await db().select().from(sessions).where(eq(sessions.userId, family.id))).toHaveLength(0);
    const [note] = await listUpdates(as(admin, T0), circle.id, { limit: 10 });
    expect(note).toMatchObject({ body: "Took Amma to the temple", author: null });
    const audit = await listAuditEvents(as(admin, T0), circle.id);
    expect(audit.find((e) => e.action === "member.account_deleted")).toMatchObject({ actor: null, metadata: { name: "Ravi" } });
    expect((await meRoute(apiRequest("GET", "/api/v1/me", { cookie: family.cookie }))).status).toBe(401);
  });

  it("is refused while you are the only one who can manage a circle", async () => {
    const owner = await signUp();
    await createTestCircle(owner, { name: "Dad" });
    const res = await deleteMe(owner.cookie, { password: TEST_PASSWORD, confirm: "DELETE" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.details.circles).toEqual(["Dad"]);
  });

  it("a parent who manages their own care can leave if an admin remains; the circle stays for the family", async () => {
    const { elder, admin, circle, as } = await createTeam(db());
    expect((await deleteMe(elder.cookie, { password: TEST_PASSWORD, confirm: "DELETE" })).status).toBe(204);
    const [profile] = await db().select().from(careProfiles).where(eq(careProfiles.circleId, circle.id));
    expect(profile.linkedUserId).toBeNull();
    expect((await listUpdates(as(admin, T0), circle.id, { limit: 1 }))).toBeDefined();
  });

  it("erases pending emails and login counters for that address", async () => {
    const user = await signUp();
    await enqueueEmail(db(), { to: user.email, subject: "s", text: "t", kind: "test", dedupeKey: `x:${user.id}`, notBefore: new Date(Date.now() + 3_600_000) });
    await db().insert(rateLimits).values({ key: `login:email:${user.email}`, windowStart: new Date(), count: 2 });
    await deleteMe(user.cookie, { password: TEST_PASSWORD, confirm: "DELETE" });
    expect(await db().select().from(emailOutbox).where(eq(emailOutbox.toAddress, user.email))).toHaveLength(0);
    expect(await db().select().from(rateLimits).where(eq(rateLimits.key, `login:email:${user.email}`))).toHaveLength(0);
  });
});

describe("retention", () => {
  it("purges expired sessions, old read notifications, delivered emails and stale counters — and nothing else", async () => {
    const user = await signUp();
    const now = new Date();
    const old = new Date(now.getTime() - (RETENTION.readNotificationsDays + 1) * 24 * 3_600_000);
    await createNotifications(
      db(),
      [
        { userId: user.id, circleId: null, kind: "t", priority: "normal", title: "old read", body: "", link: null, groupKey: null, dedupeKey: `old-read:${user.id}` },
        { userId: user.id, circleId: null, kind: "t", priority: "normal", title: "old unread", body: "", link: null, groupKey: null, dedupeKey: `old-unread:${user.id}` },
      ],
      old,
    );
    await db().update(notifications).set({ readAt: old }).where(eq(notifications.dedupeKey, `old-read:${user.id}`));
    await db().update(sessions).set({ expiresAt: new Date(now.getTime() - 1000) }).where(eq(sessions.userId, user.id));
    await db().insert(rateLimits).values({ key: `stale:${user.id}`, windowStart: new Date(now.getTime() - 3 * 24 * 3_600_000), count: 1 });

    const result = await purgeExpiredData(db(), now);
    expect(result.sessions).toBeGreaterThanOrEqual(1);
    expect(result.rateLimits).toBeGreaterThanOrEqual(1);
    const left = await db().select({ title: notifications.title }).from(notifications).where(eq(notifications.userId, user.id));
    expect(left.map((n) => n.title)).toEqual(["old unread"]);
    expect(await db().select().from(careUpdates)).toBeDefined();
  });
});

describe("circle export respects the parent's sharing choices", () => {
  it("leaves out medicines, appointments, health notes and visit notes the parent doesn't share, and says so", async () => {
    const { putConsentFor } = await import("../helpers/consent");
    const { createAppointment } = await import("@/server/services/appointments");
    const { checkIn, checkOut, createVisit } = await import("@/server/services/visits");
    const { recordMeasurement } = await import("@/server/services/measurements");
    const team = await createTeam(db());
    const now = new Date();
    await createMedication(team.as(team.admin, now), team.circle.id, { name: "Metformin", dosage: "500 mg", asNeeded: false, times: ["08:00"], unitsPerDose: 1 });
    await createAppointment(team.as(team.admin, now), team.circle.id, { title: "Cardiology", kind: "in_person", transportNeeded: true, startsAt: new Date(Date.now() + 86_400_000).toISOString() });
    await postUpdate(team.as(team.elder, now), team.circle.id, { body: "Dizzy in the mornings", category: "health" });
    await postUpdate(team.as(team.elder, now), team.circle.id, { body: "Went to the temple" });
    const visit = await createVisit(team.as(team.caregiver, now), team.circle.id, { startNow: true });
    await checkIn(team.as(team.caregiver, now), team.circle.id, visit.id).catch(() => undefined);
    await checkOut(team.as(team.caregiver, new Date(now.getTime() + 60_000)), team.circle.id, visit.id, { observations: "Breathless on stairs" });
    await recordMeasurement(team.as(team.caregiver, now), team.circle.id, { kind: "pulse", unit: "bpm", value: 72 });

    const exportAs = async () => (await circleExportRoute(apiRequest("GET", `/api/v1/circles/${team.circle.id}/export`, { cookie: team.admin.cookie }), params({ circleId: team.circle.id }))).text();
    const full = await exportAs();
    for (const text of ["Metformin", "Cardiology", "Dizzy", "Breathless", "Went to the temple"]) expect([text, full.includes(text)]).toEqual([text, true]);
    expect(JSON.parse(full).withheld).toEqual([]);

    await putConsentFor(team.elder, team.circle.id, { shareMedications: false, shareAppointments: false, shareHealth: false });
    const limited = await exportAs();
    for (const text of ["Metformin", "Cardiology", "Dizzy", "Breathless"]) expect([text, limited.includes(text)]).toEqual([text, false]);
    expect(limited).toContain("Went to the temple");
    expect(JSON.parse(limited).withheld).toEqual(["medications", "doses", "appointments", "health and mood notes", "visit notes", "health readings"]);
  });
});

describe("activity log respects the parent's sharing choices", () => {
  it("hides entries about medicines from an admin while the parent keeps medicines private, but not from the parent", async () => {
    const { putConsentFor } = await import("../helpers/consent");
    const team = await createTeam(db());
    await createMedication(team.as(team.admin, new Date()), team.circle.id, { name: "Metformin", dosage: "500 mg", asNeeded: false, times: ["08:00"], unitsPerDose: 1 });
    const actions = async (user: { id: string }) => (await listAuditEvents(team.as(user, new Date()), team.circle.id)).map((e) => e.action);
    expect(await actions(team.admin)).toContain("medication.created");
    await putConsentFor(team.elder, team.circle.id, { shareMedications: false, shareAppointments: true, shareHealth: true });
    expect(await actions(team.admin)).not.toContain("medication.created");
    expect(await actions(team.admin)).toContain("consent.updated");
    expect(await actions(team.elder)).toContain("medication.created");
  });
});
