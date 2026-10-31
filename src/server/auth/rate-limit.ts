import { eq, sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { rateLimits } from "@/server/db/schema";

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

/**
 * Atomically counts one hit against `key` in a fixed window. Safe under concurrency: the
 * upsert either starts a new window or increments the current one in a single statement.
 */
export async function consumeRateLimit(
  db: Db,
  input: { key: string; limit: number; windowMs: number; now: Date },
): Promise<RateLimitResult> {
  const { key, limit, windowMs, now } = input;
  const windowExpiredBefore = new Date(now.getTime() - windowMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStart} <= ${windowExpiredBefore.toISOString()}::timestamptz then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${rateLimits.windowStart} <= ${windowExpiredBefore.toISOString()}::timestamptz then ${now.toISOString()}::timestamptz else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count, windowStart: rateLimits.windowStart });

  const resetAt = row.windowStart.getTime() + windowMs;
  return {
    allowed: row.count <= limit,
    remaining: Math.max(0, limit - row.count),
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000)),
  };
}

export async function resetRateLimit(db: Db, key: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
}
