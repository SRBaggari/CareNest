// The devices a person turned phone alerts on for. Each person manages only their own devices.

import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { pushSubscriptions, users } from "@/server/db/schema";
import { AppError } from "@/server/http";
import { translatorFor } from "@/server/notifications/audience";
import { deliverPendingPush, enqueuePush, isAllowedPushEndpoint, pushPublicKey } from "@/server/notifications/push";
import { uuidSchema } from "@/server/validation";
import type { ServiceContext } from "./access";

/** Plenty for phones, tablets and computers; stops one account filling the table. */
export const MAX_DEVICES_PER_USER = 10;

const base64url = (min: number, max: number) => z.string().regex(/^[A-Za-z0-9_-]+=*$/, "Invalid key.").min(min).max(max);

export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .max(2000)
    .refine(isAllowedPushEndpoint, "This isn't a recognised browser push service."),
  keys: z.object({ p256dh: base64url(40, 200), auth: base64url(10, 100) }),
  label: z.string().trim().max(100).optional(),
});

export function pushConfig() {
  const publicKey = pushPublicKey();
  return { enabled: publicKey !== null, publicKey };
}

export async function listPushDevices(ctx: ServiceContext) {
  return ctx.db
    .select({ id: pushSubscriptions.id, label: pushSubscriptions.label, createdAt: pushSubscriptions.createdAt, lastSuccessAt: pushSubscriptions.lastSuccessAt })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, ctx.userId))
    .orderBy(asc(pushSubscriptions.createdAt));
}

/**
 * Saves this browser's subscription for the signed-in person. A browser has one subscription, so if
 * someone else had signed in on it before, the device now alerts the current person instead.
 */
export async function savePushDevice(ctx: ServiceContext, raw: z.input<typeof pushSubscriptionSchema>) {
  const input = pushSubscriptionSchema.parse(raw);
  if (!pushConfig().enabled) throw new AppError("conflict", "Phone alerts aren't set up on this CareNest server.");
  const [existing] = await ctx.db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, input.endpoint));
  if (!existing) {
    const [{ n }] = await ctx.db.select({ n: count() }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, ctx.userId));
    if (n >= MAX_DEVICES_PER_USER) throw new AppError("conflict", "You've turned on alerts on too many devices. Turn one off first.");
  }
  const values = { userId: ctx.userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, label: input.label ?? null };
  const [row] = await ctx.db
    .insert(pushSubscriptions)
    .values({ ...values, createdAt: ctx.now })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values })
    .returning({ id: pushSubscriptions.id });
  return row;
}

export async function removePushDevice(ctx: ServiceContext, deviceId: string) {
  if (!uuidSchema.safeParse(deviceId).success) throw new AppError("not_found", "That device isn't in your list.");
  const removed = await ctx.db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, deviceId), eq(pushSubscriptions.userId, ctx.userId)))
    .returning({ id: pushSubscriptions.id });
  if (removed.length === 0) throw new AppError("not_found", "That device isn't in your list.");
}

/** Sends a test alert to the person's own devices straight away, so they can check it works. */
export async function sendTestPush(ctx: ServiceContext) {
  if (!pushConfig().enabled) throw new AppError("conflict", "Phone alerts aren't set up on this CareNest server.");
  const [me] = await ctx.db.select({ locale: users.locale }).from(users).where(eq(users.id, ctx.userId));
  const t = translatorFor(me.locale);
  const queued = await enqueuePush(ctx.db, {
    userId: ctx.userId,
    notificationId: null,
    payload: { title: t("notif.pushTestTitle"), body: t("notif.pushTestBody"), link: "/app/account", tag: "test", urgent: false },
    dedupeKey: `push_test:${ctx.userId}:${ctx.now.getTime()}`,
    notBefore: ctx.now,
  });
  if (queued === 0) throw new AppError("conflict", "Turn on alerts on this device first.");
  return deliverPendingPush(ctx.db, ctx.now);
}

/** Turning alerts off in this browser: it knows its push address, not our id for it. */
export async function removePushDeviceByEndpoint(ctx: ServiceContext, endpoint: string) {
  await ctx.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, ctx.userId)));
}
