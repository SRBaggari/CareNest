// Private calendar links: a person's view of one circle's appointments, visits and their own tasks,
// for Google/Apple/Outlook calendars. The feed is rebuilt on every fetch as that person, so their
// permissions and the parent's sharing choices always apply, and leaving the circle stops it.

import { and, eq, isNull } from "drizzle-orm";
import { calendarFeeds, users } from "@/server/db/schema";
import { buildCalendar, type CalendarEvent } from "@/server/domain/ics";
import { generateToken, hashToken } from "@/server/auth/tokens";
import { AppError } from "@/server/http";
import { appUrl, translatorFor } from "@/server/notifications/audience";
import { loadCircleAccess, type DbOrTx, type ServiceContext } from "./access";
import { listAppointments } from "./appointments";
import { listTasks, listTasksQuerySchema } from "./tasks";
import { listVisits } from "./visits";

const HOUR = 3_600_000;
/** Past appointments stay in the calendar this long, so last week's still shows. */
const PAST_DAYS = 30;

const activeFeed = (userId: string, circleId: string) =>
  and(eq(calendarFeeds.userId, userId), eq(calendarFeeds.circleId, circleId), isNull(calendarFeeds.revokedAt));

export async function getCalendarFeed(ctx: ServiceContext, circleId: string) {
  await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  const [feed] = await ctx.db
    .select({ createdAt: calendarFeeds.createdAt, lastFetchedAt: calendarFeeds.lastFetchedAt })
    .from(calendarFeeds)
    .where(activeFeed(ctx.userId, circleId));
  return feed ? { active: true as const, ...feed } : { active: false as const };
}

/** Makes a new link (revoking any old one). The link is returned once; only its hash is kept. */
export async function createCalendarFeed(ctx: ServiceContext, circleId: string) {
  await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  const token = generateToken();
  await ctx.db.transaction(async (tx) => {
    await tx.update(calendarFeeds).set({ revokedAt: ctx.now }).where(activeFeed(ctx.userId, circleId));
    await tx.insert(calendarFeeds).values({ userId: ctx.userId, circleId, tokenHash: hashToken(token), createdAt: ctx.now });
  });
  const url = appUrl(`/api/calendar/${token}.ics`);
  return { url, webcalUrl: url.replace(/^https?:/, "webcal:") };
}

export async function revokeCalendarFeed(ctx: ServiceContext, circleId: string) {
  await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  await ctx.db.update(calendarFeeds).set({ revokedAt: ctx.now }).where(activeFeed(ctx.userId, circleId));
}

/** The calendar for a link, or null if the link is unknown, revoked, or its owner has left the circle. */
export async function calendarForToken(db: DbOrTx, token: string, now: Date): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [feed] = await db
    .select({ id: calendarFeeds.id, userId: calendarFeeds.userId, circleId: calendarFeeds.circleId, locale: users.locale, disabledAt: users.disabledAt })
    .from(calendarFeeds)
    .innerJoin(users, eq(users.id, calendarFeeds.userId))
    .where(and(eq(calendarFeeds.tokenHash, hashToken(token)), isNull(calendarFeeds.revokedAt)));
  if (!feed || feed.disabledAt) return null;

  const ctx = { db, now, userId: feed.userId };
  let access;
  try {
    access = await loadCircleAccess(db, feed.circleId, feed.userId, now);
  } catch (err) {
    if (err instanceof AppError && err.code === "not_found") return null;
    throw err;
  }
  const t = translatorFor(feed.locale);
  const name = access.profile.preferredName ?? access.profile.displayName;
  const base = `/app/circles/${feed.circleId}`;
  const open = (path: string) => t("calendar.openInCareNest", { link: appUrl(`${base}${path}`) });
  const events: CalendarEvent[] = [];

  // Titles, times, places and who is helping only: never reasons, questions for the doctor or notes,
  // because calendar apps copy events to their own servers.
  if (access.can("appointment.view")) {
    const since = now.getTime() - PAST_DAYS * 24 * HOUR;
    const [upcoming, past] = await Promise.all([
      listAppointments(ctx, feed.circleId, { range: "upcoming", limit: 200 }),
      listAppointments(ctx, feed.circleId, { range: "past", limit: 100 }),
    ]);
    for (const a of [...upcoming, ...past.filter((p) => p.startsAt.getTime() >= since)]) {
      const helping = a.transportNeeded
        ? a.transport
          ? t("appts.driving", { name: a.transport.name ?? "" })
          : t("appts.noDriver")
        : null;
      events.push({
        uid: `appointment-${a.id}@carenest`,
        start: a.startsAt,
        end: a.endsAt ?? new Date(a.startsAt.getTime() + HOUR),
        summary: t("calendar.apptSummary", { title: a.title, name }),
        location: a.kind === "virtual" ? t("appts.kind_virtual") : (a.location ?? undefined),
        description: [helping, open("/appointments")].filter(Boolean).join("\n"),
        cancelled: a.status === "cancelled",
        sequence: a.version,
      });
    }
  }
  if (access.can("update.view")) {
    for (const v of await listVisits(ctx, feed.circleId, "upcoming")) {
      events.push({
        uid: `visit-${v.id}@carenest`,
        start: v.plannedStart,
        end: v.plannedEnd ?? new Date(v.plannedStart.getTime() + HOUR),
        summary: t("calendar.visitSummary", { visitor: v.visitor?.name ?? t("audit.someone"), name }),
        description: open("/visits"),
      });
    }
  }
  if (access.can("task.view")) {
    for (const task of await listTasks(ctx, feed.circleId, listTasksQuerySchema.parse({ status: "open", assignee: "me" }))) {
      if (!task.dueAt) continue;
      events.push({
        uid: `task-${task.id}@carenest`,
        start: new Date(task.dueAt.getTime() - HOUR / 2),
        end: task.dueAt,
        summary: t("calendar.taskSummary", { title: task.title }),
        description: open("/tasks"),
        sequence: task.version,
      });
    }
  }

  await db.update(calendarFeeds).set({ lastFetchedAt: now }).where(eq(calendarFeeds.id, feed.id));
  return buildCalendar({ name: t("calendar.name", { circle: access.circle.name }), stamp: now, events });
}
