// Phone alerts through the browser's push service (Web Push with VAPID). Messages are queued in
// push_outbox and delivered like emails: claimed under a lock, retried with backoff, payload erased
// once delivered. Nothing is sent unless the server has VAPID keys.

import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/services/access";
import { pushOutbox, pushSubscriptions } from "@/server/db/schema";

/**
 * The browser supplies the URL we deliver to, so accept only the real push services: otherwise a
 * crafted "subscription" would make the server send requests anywhere (server-side request forgery).
 */
// Google's push service answers at fcm.googleapis.com for Chrome and at jmt17.google.com for
// open-source Chromium builds (seen when testing); Firefox, Safari and Edge use their own.
const PUSH_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "jmt17.google.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
const PUSH_HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export type PushPayload = { title: string; body: string; link: string | null; tag: string | null; urgent: boolean };
export type PushTarget = { endpoint: string; p256dh: string; auth: string };

/** Thrown by transports; a 404 or 410 means the device unsubscribed or the browser was reset. */
export class PushError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
  }
}

export interface PushTransport {
  readonly kind: "webpush" | "test";
  send(target: PushTarget, payload: PushPayload): Promise<void>;
}

class WebPushTransport implements PushTransport {
  readonly kind = "webpush" as const;
  constructor(private vapid: { subject: string; publicKey: string; privateKey: string }) {}
  async send(target: PushTarget, payload: PushPayload) {
    const webpush = (await import("web-push")).default;
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        {
          vapidDetails: this.vapid,
          // An alert about help is useless tomorrow; ordinary ones can wait for the phone to come online.
          TTL: payload.urgent ? 60 * 60 : 24 * 60 * 60,
          urgency: payload.urgent ? "high" : "normal",
          timeout: 10_000,
        },
      );
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      throw new PushError(err instanceof Error ? err.message : "Push failed", status);
    }
  }
}

let override: PushTransport | null | undefined;
let cached: PushTransport | null | undefined;

/** The configured transport, or null when VAPID keys aren't set (phone alerts are then off). */
export function getPushTransport(): PushTransport | null {
  if (override !== undefined) return override;
  if (cached === undefined) {
    const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = process.env;
    cached = publicKey && privateKey ? new WebPushTransport({ publicKey, privateKey, subject: subject ?? "mailto:admin@carenest.local" }) : null;
  }
  return cached;
}

export function setPushTransportForTesting(transport: PushTransport | null | undefined) {
  override = transport;
}

/** The key browsers need to subscribe; null when phone alerts are off on this server. */
export function pushPublicKey(): string | null {
  if (override !== undefined) return override ? "test-public-key" : null;
  return getPushTransport() ? process.env.VAPID_PUBLIC_KEY! : null;
}

/** Queues one alert for every device the person turned alerts on for. */
export async function enqueuePush(
  db: DbOrTx,
  input: { userId: string; notificationId: string | null; payload: PushPayload; dedupeKey: string; notBefore: Date },
) {
  if (!getPushTransport()) return 0;
  const devices = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, input.userId));
  if (devices.length === 0) return 0;
  const rows = await db
    .insert(pushOutbox)
    .values(
      devices.map((d) => ({
        subscriptionId: d.id,
        notificationId: input.notificationId,
        payload: JSON.stringify(input.payload),
        urgent: input.payload.urgent,
        dedupeKey: `${input.dedupeKey}:${d.id}`,
        nextAttemptAt: input.notBefore,
        createdAt: input.notBefore,
      })),
    )
    .onConflictDoNothing({ target: pushOutbox.dedupeKey })
    .returning({ id: pushOutbox.id });
  return rows.length;
}

export const MAX_PUSH_ATTEMPTS = 5;
const BACKOFF_MINUTES = [1, 5, 15, 60];
const LOCK_MS = 2 * 60_000;

/**
 * Sends due phone alerts, urgent ones first. Rows are claimed with SKIP LOCKED so two workers
 * (or the worker and an immediate send after a help request) never deliver the same alert.
 */
export async function deliverPendingPush(db: DbOrTx, now: Date, transport = getPushTransport(), limit = 50) {
  const results = { sent: 0, failed: 0, retried: 0, gone: 0 };
  if (!transport) return results;
  const due = db
    .select({ id: pushOutbox.id })
    .from(pushOutbox)
    .where(
      or(
        and(eq(pushOutbox.status, "pending"), lte(pushOutbox.nextAttemptAt, now)),
        and(eq(pushOutbox.status, "sending"), lte(pushOutbox.lockedUntil, now)),
      ),
    )
    .orderBy(sql`${pushOutbox.urgent} desc`, pushOutbox.nextAttemptAt)
    .limit(limit)
    .for("update", { skipLocked: true });
  const claimed = await db
    .update(pushOutbox)
    .set({ status: "sending", lockedUntil: new Date(now.getTime() + LOCK_MS), attempts: sql`${pushOutbox.attempts} + 1` })
    .where(sql`${pushOutbox.id} in (${due})`)
    .returning();
  if (claimed.length === 0) return results;

  const devices = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.id, [...new Set(claimed.map((c) => c.subscriptionId))]));
  const byId = new Map(devices.map((d) => [d.id, d]));
  const gone = new Set<string>();

  for (const item of claimed) {
    const device = byId.get(item.subscriptionId);
    if (!device || gone.has(device.id)) continue;
    try {
      if (item.payload === null) throw new PushError("Payload missing");
      await transport.send(device, JSON.parse(item.payload) as PushPayload);
      await db.update(pushOutbox).set({ status: "sent", sentAt: now, payload: null, lockedUntil: null, lastError: null }).where(eq(pushOutbox.id, item.id));
      await db.update(pushSubscriptions).set({ lastSuccessAt: now }).where(eq(pushSubscriptions.id, device.id));
      results.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 500) : "Unknown error";
      const status = err instanceof PushError ? err.statusCode : undefined;
      if (status === 404 || status === 410) {
        // The device no longer exists: stop sending to it (its queued alerts go with it).
        gone.add(device.id);
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, device.id));
        results.gone++;
        continue;
      }
      const final = item.attempts >= MAX_PUSH_ATTEMPTS || (status !== undefined && status >= 400 && status < 500 && status !== 429);
      await db
        .update(pushOutbox)
        .set(
          final
            ? { status: "failed", payload: null, lockedUntil: null, lastError: message }
            : { status: "pending", lockedUntil: null, lastError: message, nextAttemptAt: new Date(now.getTime() + BACKOFF_MINUTES[item.attempts - 1] * 60_000) },
        )
        .where(eq(pushOutbox.id, item.id));
      if (final) results.failed++;
      else results.retried++;
    }
  }
  return results;
}

/**
 * Delivers queued phone alerts right after the current response is sent, instead of waiting for
 * the worker's next tick: used when someone asks for help. Outside a request (tests, scripts) this
 * does nothing and the worker delivers on its next tick.
 */
export async function deliverPushAfterResponse(db: DbOrTx, now: Date) {
  if (!getPushTransport()) return;
  const { after } = await import("next/server");
  try {
    after(() => deliverPendingPush(db, now).then(() => undefined, (err) => console.error("Immediate phone alert delivery failed; the worker will retry.", err)));
  } catch {
    // Not inside a request.
  }
}
