import { and, eq, lte, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/services/access";
import { emailOutbox } from "@/server/db/schema";

export type OutgoingEmail = { to: string; subject: string; text: string };

export interface EmailTransport {
  /** "smtp" really delivers; "log" only writes to the server log (no provider configured). */
  readonly kind: "smtp" | "log" | "test";
  send(email: OutgoingEmail): Promise<void>;
}

class LogTransport implements EmailTransport {
  readonly kind = "log" as const;
  async send(email: OutgoingEmail) {
    // Bodies may contain private links; print them only in development.
    const body = process.env.NODE_ENV === "production" ? "[body hidden in production]" : email.text;
    console.info(`[email not sent: no SMTP_URL configured] to=${email.to} subject=${JSON.stringify(email.subject)}\n${body}`);
  }
}

class SmtpTransport implements EmailTransport {
  readonly kind = "smtp" as const;
  private transporter: Promise<import("nodemailer").Transporter>;
  constructor(
    url: string,
    private from: string,
  ) {
    this.transporter = import("nodemailer").then((m) => m.createTransport(url));
  }
  async send(email: OutgoingEmail) {
    await (await this.transporter).sendMail({ from: this.from, to: email.to, subject: email.subject, text: email.text });
  }
}

let override: EmailTransport | undefined;
let cached: EmailTransport | undefined;

/** SMTP when SMTP_URL is set (e.g. smtps://user:pass@smtp.example.com), otherwise log-only. */
export function getEmailTransport(): EmailTransport {
  if (override) return override;
  cached ??= process.env.SMTP_URL
    ? new SmtpTransport(process.env.SMTP_URL, process.env.EMAIL_FROM ?? "CareNest <no-reply@carenest.local>")
    : new LogTransport();
  return cached;
}

export function setEmailTransportForTesting(transport: EmailTransport | undefined) {
  override = transport;
}

export function emailDeliveryConfigured(): boolean {
  return getEmailTransport().kind !== "log";
}

export const MAX_EMAIL_ATTEMPTS = 5;
/** Minutes to wait before attempt 2, 3, 4, 5. */
const BACKOFF_MINUTES = [1, 5, 15, 60];
const LOCK_MS = 2 * 60_000;

export async function enqueueEmail(
  db: DbOrTx,
  input: { to: string; subject: string; text: string; kind: string; dedupeKey: string; notificationId?: string | null; notBefore: Date },
) {
  const [row] = await db
    .insert(emailOutbox)
    .values({
      toAddress: input.to,
      subject: input.subject,
      body: input.text,
      kind: input.kind,
      notificationId: input.notificationId ?? null,
      dedupeKey: input.dedupeKey,
      nextAttemptAt: input.notBefore,
      createdAt: input.notBefore,
    })
    .onConflictDoNothing({ target: emailOutbox.dedupeKey })
    .returning({ id: emailOutbox.id });
  return row ?? null;
}

/**
 * Sends due emails. Each row is claimed (status=sending + lock) in one statement using
 * SKIP LOCKED, so two workers never send the same email; a crashed worker's lock expires.
 */
export async function deliverPendingEmails(db: DbOrTx, now: Date, transport = getEmailTransport(), limit = 20) {
  const due = db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(
      or(
        and(eq(emailOutbox.status, "pending"), lte(emailOutbox.nextAttemptAt, now)),
        and(eq(emailOutbox.status, "sending"), lte(emailOutbox.lockedUntil, now)),
      ),
    )
    .orderBy(emailOutbox.nextAttemptAt)
    .limit(limit)
    .for("update", { skipLocked: true });
  const claimed = await db
    .update(emailOutbox)
    .set({ status: "sending", lockedUntil: new Date(now.getTime() + LOCK_MS), attempts: sql`${emailOutbox.attempts} + 1` })
    .where(sql`${emailOutbox.id} in (${due})`)
    .returning();

  const results = { sent: 0, failed: 0, retried: 0 };
  for (const email of claimed) {
    try {
      if (email.body === null) throw new Error("Email body missing");
      await transport.send({ to: email.toAddress, subject: email.subject, text: email.body });
      await db
        .update(emailOutbox)
        .set({ status: transport.kind === "log" ? "logged" : "sent", sentAt: now, body: null, lockedUntil: null, lastError: null })
        .where(eq(emailOutbox.id, email.id));
      results.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 500) : "Unknown error";
      const final = email.attempts >= MAX_EMAIL_ATTEMPTS;
      await db
        .update(emailOutbox)
        .set(
          final
            ? { status: "failed", body: null, lockedUntil: null, lastError: message }
            : {
                status: "pending",
                lockedUntil: null,
                lastError: message,
                nextAttemptAt: new Date(now.getTime() + BACKOFF_MINUTES[email.attempts - 1] * 60_000),
              },
        )
        .where(eq(emailOutbox.id, email.id));
      if (final) results.failed++;
      else results.retried++;
    }
  }
  return results;
}
