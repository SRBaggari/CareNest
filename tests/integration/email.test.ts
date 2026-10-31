import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST as invite } from "@/app/api/v1/circles/[circleId]/invitations/route";
import { GET as list } from "@/app/api/v1/notifications/route";
import { emailOutbox } from "@/server/db/schema";
import { deliverPendingEmails, enqueueEmail, MAX_EMAIL_ATTEMPTS, setEmailTransportForTesting } from "@/server/notifications/email";
import { notifyUsers, updatePreferences, type NewNotification } from "@/server/services/notifications";
import { createTestCircle } from "../helpers/circles";
import { setupTestDb } from "../helpers/db";
import { setupFakeEmail } from "../helpers/email";
import { apiRequest, params } from "../helpers/http";
import { signUp, type TestUser } from "../helpers/users";

const db = setupTestDb();
const email = setupFakeEmail();

const outboxRow = async (id: string) => (await db().select().from(emailOutbox).where(eq(emailOutbox.id, id)))[0];
const T0 = new Date("2026-11-14T10:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

function alert(user: TestUser, priority: NewNotification["priority"] = "high"): NewNotification & { email: { subject: string; text: string } } {
  return {
    userId: user.id,
    circleId: null,
    kind: "dose_unconfirmed",
    priority,
    title: "Dose not confirmed",
    body: "Metformin 08:00",
    link: "/app",
    groupKey: null,
    dedupeKey: `t:${user.id}:${Math.random()}`,
    email: { subject: "A dose for Amma hasn't been confirmed", text: "Open CareNest to see details." },
  };
}

describe("email outbox", () => {
  it("delivers, records the time, and erases the body afterwards", async () => {
    const row = await enqueueEmail(db(), { to: "a@example.test", subject: "Hi", text: "secret link", kind: "test", dedupeKey: "e1", notBefore: T0 });
    expect(await deliverPendingEmails(db(), T0)).toEqual({ sent: 1, failed: 0, retried: 0 });
    expect(email().sent).toEqual([{ to: "a@example.test", subject: "Hi", text: "secret link" }]);
    expect(await outboxRow(row!.id)).toMatchObject({ status: "sent", body: null, attempts: 1, sentAt: T0 });
  });

  it("is idempotent by dedupe key and does not send before its time", async () => {
    await enqueueEmail(db(), { to: "b@example.test", subject: "S", text: "T", kind: "test", dedupeKey: "e2", notBefore: minutes(30) });
    expect(await enqueueEmail(db(), { to: "b@example.test", subject: "S", text: "T", kind: "test", dedupeKey: "e2", notBefore: T0 })).toBeNull();
    await deliverPendingEmails(db(), T0);
    expect(email().sent).toHaveLength(0);
    await deliverPendingEmails(db(), minutes(30));
    expect(email().sent).toHaveLength(1);
  });

  it("retries with backoff and gives up after the maximum, erasing the body", async () => {
    const row = await enqueueEmail(db(), { to: "c@example.test", subject: "S", text: "T", kind: "test", dedupeKey: "e3", notBefore: T0 });
    email().failNext = 99;
    expect(await deliverPendingEmails(db(), T0)).toMatchObject({ retried: 1 });
    expect(await outboxRow(row!.id)).toMatchObject({ status: "pending", attempts: 1, lastError: "SMTP 451 temporary failure", nextAttemptAt: minutes(1) });
    // Not due yet: nothing happens.
    expect(await deliverPendingEmails(db(), minutes(0.5))).toEqual({ sent: 0, failed: 0, retried: 0 });

    let t = minutes(1);
    for (const wait of [5, 15, 60]) {
      await deliverPendingEmails(db(), t);
      t = new Date(t.getTime() + wait * 60_000);
    }
    expect(await deliverPendingEmails(db(), t)).toMatchObject({ failed: 1 });
    expect(await outboxRow(row!.id)).toMatchObject({ status: "failed", attempts: MAX_EMAIL_ATTEMPTS, body: null });
  });

  it("recovers after a temporary failure", async () => {
    const row = await enqueueEmail(db(), { to: "d@example.test", subject: "S", text: "T", kind: "test", dedupeKey: "e4", notBefore: T0 });
    email().failNext = 1;
    await deliverPendingEmails(db(), T0);
    await deliverPendingEmails(db(), minutes(1));
    expect(await outboxRow(row!.id)).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("never double-sends when two workers run at once", async () => {
    for (let i = 0; i < 5; i++) {
      await enqueueEmail(db(), { to: `p${i}@example.test`, subject: "S", text: "T", kind: "test", dedupeKey: `par${i}`, notBefore: T0 });
    }
    await Promise.all([deliverPendingEmails(db(), T0), deliverPendingEmails(db(), T0), deliverPendingEmails(db(), T0)]);
    expect(email().sent.map((e) => e.to).sort()).toEqual(["p0@example.test", "p1@example.test", "p2@example.test", "p3@example.test", "p4@example.test"]);
  });

  it("marks emails as only logged when no provider is configured", async () => {
    setEmailTransportForTesting(undefined);
    const original = console.info;
    console.info = () => {};
    try {
      const row = await enqueueEmail(db(), { to: "e@example.test", subject: "S", text: "T", kind: "test", dedupeKey: "e5", notBefore: T0 });
      await deliverPendingEmails(db(), T0);
      expect((await outboxRow(row!.id)).status).toBe("logged");
    } finally {
      console.info = original;
    }
  });
});

describe("notification emails", () => {
  it("are queued for new notifications, and their status shows in the notification list", async () => {
    const user = await signUp();
    await notifyUsers(db(), T0, [alert(user)]);
    await deliverPendingEmails(db(), T0);
    expect(email().sent[0]).toMatchObject({ to: user.email, subject: "A dose for Amma hasn't been confirmed" });
    expect(email().sent[0].text).not.toContain("Metformin");
    const body = await (await list(apiRequest("GET", "/api/v1/notifications", { cookie: user.cookie }))).json();
    expect(body.notifications[0].emailStatus).toBe("sent");
  });

  it("respects 'email off' and holds non-critical email until quiet hours end", async () => {
    const quiet = await signUp({ timeZone: "UTC" });
    const off = await signUp();
    await updatePreferences({ db: db(), now: T0, userId: quiet.id }, { emailEnabled: true, quietStart: "09:00", quietEnd: "11:00" });
    await updatePreferences({ db: db(), now: T0, userId: off.id }, { emailEnabled: false, quietStart: null, quietEnd: null });

    await notifyUsers(db(), T0, [alert(quiet, "high"), alert(off, "high")]);
    await deliverPendingEmails(db(), T0);
    expect(email().sent).toHaveLength(0);
    await deliverPendingEmails(db(), minutes(60));
    expect(email().sent.map((e) => e.to)).toEqual([quiet.email]);
  });

  it("critical alerts are emailed even during quiet hours", async () => {
    const user = await signUp({ timeZone: "UTC" });
    await updatePreferences({ db: db(), now: T0, userId: user.id }, { emailEnabled: true, quietStart: "09:00", quietEnd: "11:00" });
    await notifyUsers(db(), T0, [alert(user, "critical")]);
    await deliverPendingEmails(db(), T0);
    expect(email().sent).toHaveLength(1);
  });

  it("does not email again when the same notification is re-created", async () => {
    const user = await signUp();
    const n = alert(user);
    await notifyUsers(db(), T0, [n]);
    await notifyUsers(db(), T0, [n]);
    await deliverPendingEmails(db(), T0);
    expect(email().sent).toHaveLength(1);
  });
});

describe("invitation emails", () => {
  it("emails the invitee a working link and erases it from the outbox once sent", async () => {
    const owner = await signUp({ name: "Priya" });
    const circle = await createTestCircle(owner);
    const res = await invite(
      apiRequest("POST", `/api/v1/circles/${circle.id}/invitations`, { cookie: owner.cookie, body: { email: "ravi@example.test", role: "family" } }),
      params({ circleId: circle.id }),
    );
    const { inviteUrl, emailDelivery } = await res.json();
    expect(emailDelivery).toBe("queued");
    await deliverPendingEmails(db(), new Date());
    const sent = email().sent.find((e) => e.to === "ravi@example.test")!;
    expect(sent.subject).toBe("Priya invited you to help care for Lakshmi Rao on CareNest");
    expect(sent.text).toContain(inviteUrl);
    const rows = await db().select().from(emailOutbox).where(eq(emailOutbox.toAddress, "ravi@example.test"));
    expect(rows[0].body).toBeNull();
  });
});
