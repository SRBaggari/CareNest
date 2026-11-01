// Text messages: a transport adapter and an outbox with retries (the same design as push and email).
// No real SMS provider is wired yet. SMS_TRANSPORT selects one of:
//   (unset)            text messages are off; the account page says so
//   log                development: messages are printed, not sent
//   file:<path>        tests: messages are appended to a JSON-lines file
// A real provider (with India's DLT sender and template registration) is a separate, later step.

import { appendFile } from "node:fs/promises";
import { and, eq, lte, or, sql } from "drizzle-orm";
import { smsOutbox } from "@/server/db/schema";
import type { DbOrTx } from "@/server/services/access";

export interface SmsTransport {
  readonly kind: "log" | "file" | "test";
  send(to: string, body: string): Promise<void>;
}

class LogTransport implements SmsTransport {
  readonly kind = "log" as const;
  async send(to: string, body: string) {
    console.info(`[sms] to ${to}: ${body}`);
  }
}

class FileTransport implements SmsTransport {
  readonly kind = "file" as const;
  constructor(private path: string) {}
  async send(to: string, body: string) {
    await appendFile(this.path, JSON.stringify({ to, body }) + "\n", "utf8");
  }
}

let override: SmsTransport | null | undefined;
let cached: SmsTransport | null | undefined;

export function getSmsTransport(): SmsTransport | null {
  if (override !== undefined) return override;
  if (cached === undefined) {
    const setting = process.env.SMS_TRANSPORT ?? "";
    cached = setting === "log" ? new LogTransport() : setting.startsWith("file:") ? new FileTransport(setting.slice(5)) : null;
  }
  return cached;
}

export function setSmsTransportForTesting(transport: SmsTransport | null | undefined) {
  override = transport;
}

export async function enqueueSms(
  db: DbOrTx,
  input: { userId: string; to: string; body: string; kind: "alert" | "code"; urgent: boolean; notificationId?: string | null; dedupeKey: string; notBefore: Date },
) {
  if (!getSmsTransport()) return 0;
  const rows = await db
    .insert(smsOutbox)
    .values({
      userId: input.userId,
      to: input.to,
      body: input.body,
      kind: input.kind,
      urgent: input.urgent,
      notificationId: input.notificationId ?? null,
      dedupeKey: input.dedupeKey,
      nextAttemptAt: input.notBefore,
      createdAt: input.notBefore,
    })
    .onConflictDoNothing({ target: smsOutbox.dedupeKey })
    .returning({ id: smsOutbox.id });
  return rows.length;
}

export const MAX_SMS_ATTEMPTS = 4;
const BACKOFF_MINUTES = [1, 5, 15];
const LOCK_MS = 2 * 60_000;

/** Sends due texts, urgent ones first; rows are claimed with SKIP LOCKED so nothing is sent twice. */
export async function deliverPendingSms(db: DbOrTx, now: Date, transport = getSmsTransport(), limit = 50) {
  const results = { sent: 0, failed: 0, retried: 0 };
  if (!transport) return results;
  const due = db
    .select({ id: smsOutbox.id })
    .from(smsOutbox)
    .where(or(and(eq(smsOutbox.status, "pending"), lte(smsOutbox.nextAttemptAt, now)), and(eq(smsOutbox.status, "sending"), lte(smsOutbox.lockedUntil, now))))
    .orderBy(sql`${smsOutbox.urgent} desc`, smsOutbox.nextAttemptAt)
    .limit(limit)
    .for("update", { skipLocked: true });
  const claimed = await db
    .update(smsOutbox)
    .set({ status: "sending", lockedUntil: new Date(now.getTime() + LOCK_MS), attempts: sql`${smsOutbox.attempts} + 1` })
    .where(sql`${smsOutbox.id} in (${due})`)
    .returning();

  for (const item of claimed) {
    try {
      if (item.body === null) throw new Error("Message missing");
      await transport.send(item.to, item.body);
      await db.update(smsOutbox).set({ status: "sent", sentAt: now, body: null, lockedUntil: null, lastError: null }).where(eq(smsOutbox.id, item.id));
      results.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 500) : "Unknown error";
      const final = item.attempts >= MAX_SMS_ATTEMPTS;
      await db
        .update(smsOutbox)
        .set(
          final
            ? { status: "failed", body: null, lockedUntil: null, lastError: message }
            : { status: "pending", lockedUntil: null, lastError: message, nextAttemptAt: new Date(now.getTime() + BACKOFF_MINUTES[item.attempts - 1] * 60_000) },
        )
        .where(eq(smsOutbox.id, item.id));
      if (final) results.failed++;
      else results.retried++;
    }
  }
  return results;
}

/** Sends queued texts right after the response (help requests, codes) instead of on the next tick. */
export async function deliverSmsAfterResponse(db: DbOrTx, now: Date) {
  if (!getSmsTransport()) return;
  const { after } = await import("next/server");
  try {
    after(() => deliverPendingSms(db, now).then(() => undefined, (err) => console.error("Immediate text message delivery failed; the worker will retry.", err)));
  } catch {
    // Outside a request: the worker delivers on its next tick.
  }
}
