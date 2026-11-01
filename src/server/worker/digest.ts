// The daily digest: one evening email per person listing the day's low-priority news (completed
// visits, everyday updates) that they haven't already seen in the app. Low-priority items never
// get an email of their own, so without this, family who don't open the app would miss them.

import { and, asc, eq, gt, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { DateTime } from "luxon";
import type { Db } from "@/server/db";
import { notificationPreferences, notifications, users } from "@/server/db/schema";
import { appUrl, translatorFor } from "@/server/notifications/audience";
import { enqueueEmail } from "@/server/notifications/email";
import { quietUntil } from "@/server/notifications/quiet-hours";

/** Local time, in each person's own zone, from which their digest may go out. */
export const DIGEST_LOCAL_TIME = "18:00";
/** How far back a first digest looks, and the most a later one covers. */
export const DIGEST_LOOKBACK_HOURS = 24;
/** A digest lists at most this many items; the rest are behind the link. */
export const DIGEST_MAX_ITEMS = 20;

/**
 * The local date a digest is due for, or null if none is due: it is past the digest time in the
 * person's zone and none has gone out yet today (their today).
 */
export function digestDueFor(now: Date, timeZone: string, lastDigestAt: Date | null): string | null {
  const local = DateTime.fromJSDate(now, { zone: timeZone });
  const [h, m] = DIGEST_LOCAL_TIME.split(":").map(Number);
  if (local.hour * 60 + local.minute < h * 60 + m) return null;
  if (lastDigestAt && lastDigestAt >= local.startOf("day").toJSDate()) return null;
  return local.toISODate();
}

export async function sendDailyDigests(db: Db, now: Date) {
  const since = new Date(now.getTime() - DIGEST_LOOKBACK_HOURS * 3_600_000);
  const unseenLow = (userId?: string) =>
    and(
      eq(notifications.priority, "low"),
      isNull(notifications.readAt),
      gt(notifications.createdAt, since),
      lte(notifications.createdAt, now),
      userId ? eq(notifications.userId, userId) : undefined,
    );
  const candidates = await db.selectDistinct({ userId: notifications.userId }).from(notifications).where(unseenLow());
  if (candidates.length === 0) return 0;

  const people = await db
    .select({
      id: users.id,
      email: users.email,
      locale: users.locale,
      timeZone: users.timeZone,
      emailEnabled: notificationPreferences.emailEnabled,
      digestEnabled: notificationPreferences.digestEnabled,
      lastDigestAt: notificationPreferences.lastDigestAt,
      quietStart: notificationPreferences.quietStart,
      quietEnd: notificationPreferences.quietEnd,
    })
    .from(users)
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
    .where(and(inArray(users.id, candidates.map((c) => c.userId)), isNull(users.disabledAt)));

  let queued = 0;
  for (const p of people) {
    // No preferences row means the defaults: email on, digest on.
    if (p.emailEnabled === false || p.digestEnabled === false) continue;
    const day = digestDueFor(now, p.timeZone, p.lastDigestAt);
    if (!day) continue;
    const from = p.lastDigestAt && p.lastDigestAt > since ? p.lastDigestAt : since;
    const items = await db
      .select({ title: notifications.title })
      .from(notifications)
      .where(and(unseenLow(p.id), gt(notifications.createdAt, from)))
      .orderBy(asc(notifications.createdAt));
    if (items.length === 0) continue;

    // Claim today's digest: only one overlapping tick wins the conditional update.
    const startOfDay = DateTime.fromJSDate(now, { zone: p.timeZone }).startOf("day").toJSDate();
    const [claimed] = await db
      .insert(notificationPreferences)
      .values({ userId: p.id, lastDigestAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: { lastDigestAt: now },
        setWhere: or(isNull(notificationPreferences.lastDigestAt), lt(notificationPreferences.lastDigestAt, startOfDay)),
      })
      .returning({ userId: notificationPreferences.userId });
    if (!claimed) continue;

    const t = translatorFor(p.locale);
    const shown = items.slice(0, DIGEST_MAX_ITEMS);
    // Titles only: they name who did what, never medical detail, which stays behind sign-in.
    const lines = [
      t("notif.digestIntro"),
      "",
      ...shown.map((i) => `• ${i.title}`),
      ...(items.length > shown.length ? [t("notif.digestMore", { count: items.length - shown.length })] : []),
      "",
      t("notif.digestFooter", { link: appUrl("/app/notifications") }),
    ];
    await enqueueEmail(db, {
      to: p.email,
      subject: t("notif.digestSubject", { count: items.length }),
      text: lines.join("\n"),
      kind: "daily_digest",
      dedupeKey: `digest:${p.id}:${day}`,
      notBefore: quietUntil(now, p.timeZone, p.quietStart, p.quietEnd) ?? now,
    });
    queued++;
  }
  return queued;
}
