import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as smsGet, PUT as smsPut } from "@/app/api/v1/me/sms/route";
import { POST as smsVerify } from "@/app/api/v1/me/sms/verify/route";
import { smsOutbox } from "@/server/db/schema";
import { deliverPendingSms, MAX_SMS_ATTEMPTS, setSmsTransportForTesting } from "@/server/notifications/sms";
import { raiseAssistance } from "@/server/services/assistance";
import { exportMyData } from "@/server/services/data-rights";
import { confirmPhone, getMySms, removePhone, startPhoneVerification, updateSmsSettings } from "@/server/services/sms";
import { postUpdate } from "@/server/services/updates";
import { createTeam } from "../helpers/circles";
import { setupTestDb } from "../helpers/db";
import { setupFakeEmail } from "../helpers/email";
import { apiRequest } from "../helpers/http";
import { setupFakeSms } from "../helpers/sms";
import { signUp } from "../helpers/users";

const db = setupTestDb();
setupFakeEmail();
const sms = setupFakeSms();
const T0 = new Date("2026-11-14T06:30:00Z"); // midday in Kolkata
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const ctx = (user: { id: string }, now = T0) => ({ db: db(), now, userId: user.id });

/** Adds and confirms a number for someone, as they would on the account page. */
async function verified(user: { id: string }, phone: string, now = T0) {
  await startPhoneVerification(ctx(user, now), { phone });
  await confirmPhone(ctx(user, now), { code: sms().codeFor(phone.replace(/[\s-]/g, ""))! });
}

describe("adding a number for text messages", () => {
  it("texts a code, and the number is used only once the code is confirmed", async () => {
    const me = await signUp();
    const state = await startPhoneVerification(ctx(me), { phone: "+91 90000 00001" });
    expect(state).toMatchObject({ available: true, phone: "+91 ••••• •0001", verified: false, urgentOnly: true });
    expect(sms().sent).toEqual([{ to: "+919000000001", body: expect.stringMatching(/^CareNest code: \d{6}\. It works for 10 minutes\./) }]);

    await expect(confirmPhone(ctx(me), { code: "000000" === sms().codeFor("+919000000001") ? "111111" : "000000" })).rejects.toMatchObject({ details: { code: ["That code isn't right."] } });
    expect(await confirmPhone(ctx(me, at(2)), { code: sms().codeFor("+919000000001")! })).toMatchObject({ verified: true });
    expect(await getMySms(ctx(me))).toMatchObject({ phone: "+91 ••••• •0001", verified: true });
  });

  it("refuses numbers without a country code or that can't be real", async () => {
    const me = await signUp();
    await expect(startPhoneVerification(ctx(me), { phone: "90000 00001" })).rejects.toMatchObject({ code: "validation_failed", details: { phone: expect.any(Array) } });
    expect(sms().sent).toEqual([]);
  });

  it("limits codes (one a minute, five a day) and guesses (five per code), and codes expire", async () => {
    const me = await signUp();
    await startPhoneVerification(ctx(me), { phone: "+919000000002" });
    await expect(startPhoneVerification(ctx(me, at(0.5)), { phone: "+919000000002" })).rejects.toMatchObject({ code: "rate_limited" });
    for (let i = 1; i <= 4; i++) await startPhoneVerification(ctx(me, at(i * 2)), { phone: "+919000000002" });
    await expect(startPhoneVerification(ctx(me, at(20)), { phone: "+919000000002" })).rejects.toMatchObject({ code: "rate_limited" });

    const other = await signUp();
    await startPhoneVerification(ctx(other), { phone: "+919000000003" });
    const right = sms().codeFor("+919000000003")!;
    const wrong = right === "123456" ? "654321" : "123456";
    for (let i = 0; i < 5; i++) await expect(confirmPhone(ctx(other), { code: wrong })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(confirmPhone(ctx(other), { code: right })).rejects.toMatchObject({ details: { code: ["Too many wrong codes. Ask for a new one."] } });

    const late = await signUp();
    await startPhoneVerification(ctx(late), { phone: "+919000000004" });
    await expect(confirmPhone(ctx(late, at(11)), { code: sms().codeFor("+919000000004")! })).rejects.toMatchObject({ details: { code: ["That code has expired. Ask for a new one."] } });
  });

  it("is off, and says so, when the server has no way to send texts", async () => {
    const me = await signUp();
    setSmsTransportForTesting(null);
    expect(await getMySms(ctx(me))).toMatchObject({ available: false, phone: null });
    await expect(startPhoneVerification(ctx(me), { phone: "+919000000005" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("each person sees and confirms only their own number; signed out is 401", async () => {
    const a = await signUp();
    const b = await signUp();
    await verified(a, "+919000000006");
    expect((await (await smsGet(apiRequest("GET", "/api/v1/me/sms", { cookie: b.cookie }))).json()).phone).toBeNull();
    // B has no number waiting, so A's code means nothing to B's account.
    const res = await smsVerify(apiRequest("POST", "/api/v1/me/sms/verify", { cookie: b.cookie, body: { code: "123456" } }));
    expect(res.status).toBe(409);
    expect((await smsGet(apiRequest("GET", "/api/v1/me/sms"))).status).toBe(401);
    expect((await smsPut(apiRequest("PUT", "/api/v1/me/sms", { body: { phone: "+919000000007" } }))).status).toBe(401);
    expect((await smsVerify(apiRequest("POST", "/api/v1/me/sms/verify", { body: { code: "123456" } }))).status).toBe(401);
  });
});

describe("which alerts are texted", () => {
  it("a request for help is texted with only a name; other alerts only to people who asked, without details", async () => {
    const team = await createTeam(db());
    const { admin, family, elder, circle, as } = team;
    await verified(admin, "+919000000011"); // default: only requests for help
    await verified(family, "+447700900123");
    await updateSmsSettings(ctx(family), { urgentOnly: false });
    sms().sent = [];

    // An important update (high priority) mentions health; the text must not.
    await postUpdate(as(elder, at(5)), circle.id, { body: "Knee pain again, BP 160/100", category: "health", important: true });
    // An everyday update (low priority) is never texted.
    await postUpdate(as(elder, at(6)), circle.id, { body: "Lovely walk today" });
    await deliverPendingSms(db(), at(7));
    expect(sms().sent).toEqual([{ to: "+447700900123", body: expect.stringMatching(/^CareNest: you have a new alert\. Open http/) }]);
    expect(JSON.stringify(sms().sent)).not.toMatch(/Knee|160|walk/);

    sms().sent = [];
    await raiseAssistance(as(elder, at(10)), circle.id, { message: "I fell in the bathroom" });
    await deliverPendingSms(db(), at(10));
    expect(sms().sent.map((m) => m.to).sort()).toEqual(["+447700900123", "+919000000011"]);
    for (const m of sms().sent) {
      expect(m.body).toMatch(/^CareNest: .*Amma.* Open http.*\/emergency\//);
      // The message the parent typed stays behind sign-in.
      expect(m.body).not.toContain("bathroom");
    }
  });

  it("only verified numbers are used, and removing the number stops everything queued", async () => {
    const team = await createTeam(db());
    const { admin, family, elder, circle, as } = team;
    await startPhoneVerification(ctx(admin), { phone: "+919000000021" }); // never confirmed
    await verified(family, "+919000000022");
    sms().sent = [];
    await raiseAssistance(as(elder, at(5)), circle.id, {});
    await removePhone(ctx(family, at(5)));
    await deliverPendingSms(db(), at(6));
    expect(sms().sent).toEqual([]);
    expect((await exportMyData(ctx(family))).textMessages).toBeNull();
  });

  it("retries a failed text, then gives up, keeping no message text", async () => {
    const team = await createTeam(db());
    const { admin, elder, circle, as } = team;
    await verified(admin, "+919000000031");
    sms().failNext = MAX_SMS_ATTEMPTS;
    await raiseAssistance(as(elder, at(5)), circle.id, {});
    let now = at(5);
    for (let i = 0; i < MAX_SMS_ATTEMPTS; i++) {
      await deliverPendingSms(db(), now);
      now = new Date(now.getTime() + 61 * 60_000);
    }
    const [row] = await db().select().from(smsOutbox).where(and(eq(smsOutbox.kind, "alert"), eq(smsOutbox.userId, admin.id)));
    expect(row).toMatchObject({ status: "failed", attempts: MAX_SMS_ATTEMPTS, body: null, lastError: "SMS provider unavailable" });
    expect((await exportMyData(ctx(admin))).textMessages).toMatchObject({ phone: "+919000000031", urgentOnly: true });
  });
});
