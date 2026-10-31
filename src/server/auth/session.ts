import { and, eq, gt, ne } from "drizzle-orm";
import type { Db } from "@/server/db";
import { sessions, users } from "@/server/db/schema";
import { generateToken, hashToken } from "./tokens";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sessions used within this long of expiry are extended (sliding expiration). */
export const SESSION_RENEW_WITHIN_MS = 15 * 24 * 60 * 60 * 1000;
/** Avoid a DB write on every request: last_seen_at granularity. */
const LAST_SEEN_GRANULARITY_MS = 5 * 60 * 1000;

export const generateSessionToken = generateToken;
export const hashSessionToken = hashToken;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  locale: string;
  timeZone: string;
};

export type ValidatedSession = {
  sessionId: string;
  expiresAt: Date;
  user: SessionUser;
};

export async function createSession(
  db: Db,
  input: { userId: string; now: Date; userAgent?: string | null },
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(input.now.getTime() + SESSION_TTL_MS);
  const [row] = await db
    .insert(sessions)
    .values({
      tokenHash: hashSessionToken(token),
      userId: input.userId,
      expiresAt,
      lastSeenAt: input.now,
      createdAt: input.now,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    })
    .returning({ id: sessions.id });
  return { token, sessionId: row.id, expiresAt };
}

/**
 * Resolves a cookie token to an active session + user. Expired sessions and disabled users
 * are rejected; expired rows are deleted. Near-expiry sessions are extended.
 */
export async function validateSessionToken(db: Db, token: string, now: Date): Promise<ValidatedSession | null> {
  if (!token || token.length > 100) return null;
  const tokenHash = hashSessionToken(token);
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      user: {
        id: users.id,
        email: users.email,
        name: users.name,
        locale: users.locale,
        timeZone: users.timeZone,
      },
      disabledAt: users.disabledAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt.getTime() <= now.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, row.sessionId));
    return null;
  }
  if (row.disabledAt) return null;

  let expiresAt = row.expiresAt;
  const renew = expiresAt.getTime() - now.getTime() < SESSION_RENEW_WITHIN_MS;
  const touch = now.getTime() - row.lastSeenAt.getTime() > LAST_SEEN_GRANULARITY_MS;
  if (renew || touch) {
    if (renew) expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await db.update(sessions).set({ expiresAt, lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }
  return { sessionId: row.sessionId, expiresAt, user: row.user };
}

export async function invalidateSessionToken(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
}

/** Signs the user out everywhere, optionally keeping the current device signed in. */
export async function invalidateUserSessions(db: Db, userId: string, exceptSessionId?: string): Promise<void> {
  await db
    .delete(sessions)
    .where(exceptSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)) : eq(sessions.userId, userId));
}

export async function listUserSessions(db: Db, userId: string, now: Date) {
  return db
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
    .orderBy(sessions.lastSeenAt);
}

/** Revokes one of the user's own sessions; returns false if it is not theirs / does not exist. */
export async function revokeUserSession(db: Db, userId: string, sessionId: string): Promise<boolean> {
  const deleted = await db
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning({ id: sessions.id });
  return deleted.length > 0;
}
