// A person's own number for text messages: add it, prove it's theirs with a code, choose which
// alerts are texted, remove it. Each person manages only their own number.

import { randomInt } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { smsOutbox, smsPhones, users } from "@/server/db/schema";
import { maskPhone, normalizePhone } from "@/server/domain/phone";
import { hashToken } from "@/server/auth/tokens";
import { AppError } from "@/server/http";
import { translatorFor } from "@/server/notifications/audience";
import { deliverPendingSms, enqueueSms, getSmsTransport } from "@/server/notifications/sms";
import type { ServiceContext } from "./access";

export const setPhoneSchema = z.object({ phone: z.string().trim().min(1, "Enter a phone number.").max(30) });
export const verifyPhoneSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.") });
export const smsSettingsSchema = z.object({ urgentOnly: z.boolean() });

const CODE_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;
const RESEND_SECONDS = 60;
const MAX_CODES_PER_DAY = 5;

const codeHash = (userId: string, code: string) => hashToken(`${userId}:${code}`);

export async function getMySms(ctx: ServiceContext) {
  const [row] = await ctx.db.select().from(smsPhones).where(eq(smsPhones.userId, ctx.userId));
  return {
    /** False when this server has no way to send texts: the page says so instead of offering it. */
    available: getSmsTransport() !== null,
    phone: row ? maskPhone(row.phone) : null,
    verified: Boolean(row?.verifiedAt),
    urgentOnly: row?.urgentOnly ?? true,
  };
}

/** Saves a (new) number as unverified and texts a code to it. */
export async function startPhoneVerification(ctx: ServiceContext, raw: z.input<typeof setPhoneSchema>) {
  const input = setPhoneSchema.parse(raw);
  if (!getSmsTransport()) throw new AppError("conflict", "Text messages aren't set up on this server.");
  const phone = normalizePhone(input.phone);
  if (!phone) throw new AppError("validation_failed", "Some fields are invalid.", { phone: ["Enter the number with its country code, like +91 90000 00001."] });

  const [existing] = await ctx.db.select().from(smsPhones).where(eq(smsPhones.userId, ctx.userId));
  const sameDay = existing?.codeSentAt && existing.codeSentAt.toISOString().slice(0, 10) === ctx.now.toISOString().slice(0, 10);
  const sentToday = sameDay ? existing.codesSentToday : 0;
  if (existing?.codeSentAt && ctx.now.getTime() - existing.codeSentAt.getTime() < RESEND_SECONDS * 1000) {
    throw new AppError("rate_limited", "Please wait a minute before asking for another code.", { retryAfterSeconds: RESEND_SECONDS });
  }
  if (sentToday >= MAX_CODES_PER_DAY) throw new AppError("rate_limited", "Too many codes today. Please try again tomorrow.");

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const values = {
    phone,
    verifiedAt: null,
    codeHash: codeHash(ctx.userId, code),
    codeExpiresAt: new Date(ctx.now.getTime() + CODE_MINUTES * 60_000),
    codeAttempts: 0,
    codeSentAt: ctx.now,
    codesSentToday: sentToday + 1,
  };
  await ctx.db
    .insert(smsPhones)
    .values({ userId: ctx.userId, ...values, createdAt: ctx.now })
    .onConflictDoUpdate({ target: smsPhones.userId, set: values });
  // Alerts still queued for an old number are not sent to the new one.
  await ctx.db.update(smsOutbox).set({ status: "failed", body: null, lastError: "Number changed" }).where(and(eq(smsOutbox.userId, ctx.userId), inArray(smsOutbox.status, ["pending", "sending"])));

  const [me] = await ctx.db.select({ locale: users.locale }).from(users).where(eq(users.id, ctx.userId));
  const t = translatorFor(me?.locale ?? "en");
  await enqueueSms(ctx.db, { userId: ctx.userId, to: phone, body: t("notif.smsCode", { code, minutes: CODE_MINUTES }), kind: "code", urgent: true, dedupeKey: `sms-code:${ctx.userId}:${ctx.now.getTime()}`, notBefore: ctx.now });
  // The code is needed now, not on the worker's next tick.
  await deliverPendingSms(ctx.db, ctx.now);
  return getMySms(ctx);
}

export async function confirmPhone(ctx: ServiceContext, raw: z.input<typeof verifyPhoneSchema>) {
  const input = verifyPhoneSchema.parse(raw);
  const [row] = await ctx.db.select().from(smsPhones).where(eq(smsPhones.userId, ctx.userId));
  if (!row || row.verifiedAt) throw new AppError("conflict", "There's no number waiting for a code.");
  const wrong = (message: string) => new AppError("validation_failed", "Some fields are invalid.", { code: [message] });
  if (!row.codeHash || !row.codeExpiresAt || row.codeExpiresAt <= ctx.now) throw wrong("That code has expired. Ask for a new one.");
  if (row.codeAttempts >= MAX_CODE_ATTEMPTS) throw wrong("Too many wrong codes. Ask for a new one.");
  if (codeHash(ctx.userId, input.code) !== row.codeHash) {
    await ctx.db.update(smsPhones).set({ codeAttempts: row.codeAttempts + 1 }).where(eq(smsPhones.userId, ctx.userId));
    throw wrong("That code isn't right.");
  }
  await ctx.db.update(smsPhones).set({ verifiedAt: ctx.now, codeHash: null, codeExpiresAt: null, codeAttempts: 0 }).where(eq(smsPhones.userId, ctx.userId));
  return getMySms(ctx);
}

export async function updateSmsSettings(ctx: ServiceContext, raw: z.input<typeof smsSettingsSchema>) {
  const input = smsSettingsSchema.parse(raw);
  const updated = await ctx.db.update(smsPhones).set({ urgentOnly: input.urgentOnly }).where(eq(smsPhones.userId, ctx.userId)).returning({ userId: smsPhones.userId });
  if (updated.length === 0) throw new AppError("not_found", "No phone number saved.");
  return getMySms(ctx);
}

/** Stops all text messages: the number is deleted and anything still queued is dropped. */
export async function removePhone(ctx: ServiceContext) {
  await ctx.db.delete(smsPhones).where(eq(smsPhones.userId, ctx.userId));
  await ctx.db.update(smsOutbox).set({ status: "failed", body: null, lastError: "Number removed" }).where(and(eq(smsOutbox.userId, ctx.userId), inArray(smsOutbox.status, ["pending", "sending"])));
}
