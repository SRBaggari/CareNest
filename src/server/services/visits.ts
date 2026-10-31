import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { careProfiles, memberships, users, visits } from "@/server/db/schema";
import { AppError } from "@/server/http";
import { appUrl, circleAudience, translatorFor } from "@/server/notifications/audience";
import { uuidSchema } from "@/server/validation";
import { authorize, loadCircleAccess, requireWritable, type CircleAccess, type DbOrTx, type ServiceContext } from "./access";
import { recordAudit } from "./audit";
import { HELPER_ROLES, resolveActiveMember } from "./members";
import { notifyUsers } from "./notifications";

/** Visitors may check in up to this long before the planned start. */
export const EARLY_CHECK_IN_MINUTES = 120;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();
const instant = z.iso.datetime({ offset: true, message: "Enter a valid date and time." });

export const createVisitSchema = z
  .object({
    /** Who visits; defaults to the person creating it. */
    visitorMemberId: z.string().optional(),
    plannedStart: instant.optional(),
    plannedEnd: instant.nullable().optional(),
    purpose: optionalText(500),
    /** Ad-hoc visit: create and check in at once. */
    startNow: z.boolean().default(false),
  })
  .refine((v) => v.startNow || v.plannedStart, { message: "Choose when the visit is.", path: ["plannedStart"] })
  .refine((v) => !v.plannedStart || !v.plannedEnd || new Date(v.plannedEnd) > new Date(v.plannedStart), {
    message: "The end must be after the start.",
    path: ["plannedEnd"],
  });

export const checkOutSchema = z.object({
  observations: optionalText(4000),
  handoverNote: optionalText(4000),
  unresolvedIssues: optionalText(2000),
});

export const cancelVisitSchema = z.object({ reason: z.string().trim().min(1, "Please give a short reason.").max(500) });

const visitor = alias(memberships, "visitor");
const visitorUser = alias(users, "visitor_user");

function selectVisits(db: DbOrTx) {
  return db
    .select({ visit: visits, visitorName: visitorUser.name, visitorUserId: visitorUser.id })
    .from(visits)
    .leftJoin(visitor, eq(visitor.id, visits.visitorMemberId))
    .leftJoin(visitorUser, eq(visitorUser.id, visitor.userId));
}

type Row = Awaited<ReturnType<ReturnType<typeof selectVisits>["limit"]>>[number];

/** Observations and handover notes are health information: hidden unless the viewer may see health details. */
function serialize(r: Row, access: CircleAccess, viewerUserId: string) {
  const v = r.visit;
  // Visitors always see what they wrote themselves.
  const showDetails = access.can("health.view") || r.visitorUserId === viewerUserId;
  return {
    id: v.id,
    visitor: v.visitorMemberId ? { memberId: v.visitorMemberId, name: r.visitorName } : null,
    plannedStart: v.plannedStart,
    plannedEnd: v.plannedEnd,
    status: v.status,
    purpose: v.purpose,
    checkedInAt: v.checkedInAt,
    checkedOutAt: v.checkedOutAt,
    detailsHidden: !showDetails && Boolean(v.observations || v.handoverNote || v.unresolvedIssues),
    observations: showDetails ? v.observations : null,
    handoverNote: showDetails ? v.handoverNote : null,
    unresolvedIssues: showDetails ? v.unresolvedIssues : null,
    cancelReason: v.cancelReason,
    cancelledAt: v.cancelledAt,
  };
}

async function loadForUpdate(tx: DbOrTx, circleId: string, visitId: string) {
  if (!uuidSchema.safeParse(visitId).success) throw new AppError("not_found", "Visit not found.");
  const [v] = await tx.select().from(visits).where(and(eq(visits.id, visitId), eq(visits.circleId, circleId))).for("update");
  if (!v) throw new AppError("not_found", "Visit not found.");
  return v;
}

async function getView(ctx: ServiceContext, access: CircleAccess, visitId: string) {
  const [row] = await selectVisits(ctx.db).where(eq(visits.id, visitId)).limit(1);
  return serialize(row, access, ctx.userId);
}

export async function listVisits(ctx: ServiceContext, circleId: string, range: "upcoming" | "recent") {
  const access = await authorize(ctx, circleId, "update.view");
  const pivot = new Date(ctx.now.getTime() - 12 * 3_600_000);
  const rows = await selectVisits(ctx.db)
    .where(
      and(
        eq(visits.circleId, circleId),
        range === "upcoming"
          ? sql`(${visits.status} in ('planned', 'in_progress') and ${visits.plannedStart} >= ${pivot.toISOString()}::timestamptz) or ${visits.status} = 'in_progress'`
          : sql`${visits.status} in ('completed', 'cancelled') or (${visits.status} = 'planned' and ${visits.plannedStart} < ${pivot.toISOString()}::timestamptz)`,
      ),
    )
    .orderBy(range === "upcoming" ? asc(visits.plannedStart) : desc(visits.plannedStart))
    .limit(50);
  return rows.map((r) => serialize(r, access, ctx.userId));
}

/** The most recent handover note, shown at the top for whoever comes next. */
export async function latestHandover(ctx: ServiceContext, circleId: string) {
  const access = await authorize(ctx, circleId, "update.view");
  if (!access.can("health.view")) return null;
  const [row] = await selectVisits(ctx.db)
    .where(and(eq(visits.circleId, circleId), eq(visits.status, "completed"), isNotNull(visits.handoverNote)))
    .orderBy(desc(visits.checkedOutAt))
    .limit(1);
  return row ? serialize(row, access, ctx.userId) : null;
}

export async function createVisit(ctx: ServiceContext, circleId: string, raw: z.input<typeof createVisitSchema>) {
  const input = createVisitSchema.parse(raw);
  const access = await authorize(ctx, circleId, "visit.record", { write: true });
  const visitorId = input.visitorMemberId ?? access.membership.id;
  // Caregivers plan their own visits; family and admins can plan anyone's.
  if (visitorId !== access.membership.id && access.membership.role === "caregiver") {
    throw new AppError("forbidden", "Caregivers can plan their own visits.");
  }
  if (input.startNow && visitorId !== access.membership.id) {
    throw new AppError("validation_failed", "Some fields are invalid.", { startNow: ["Only the visitor can start a visit now."] });
  }
  const id = await ctx.db.transaction(async (tx) => {
    await resolveActiveMember(tx, circleId, visitorId, ctx.now, HELPER_ROLES);
    const start = input.startNow ? ctx.now : new Date(input.plannedStart!);
    const [row] = await tx
      .insert(visits)
      .values({
        circleId,
        visitorMemberId: visitorId,
        plannedStart: start,
        plannedEnd: input.plannedEnd ? new Date(input.plannedEnd) : null,
        purpose: input.purpose ?? null,
        status: input.startNow ? "in_progress" : "planned",
        checkedInAt: input.startNow ? ctx.now : null,
        createdBy: ctx.userId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .returning({ id: visits.id });
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: input.startNow ? "visit.started" : "visit.planned",
      entityType: "visit",
      entityId: row.id,
      metadata: { visitorMemberId: visitorId, plannedStart: start },
      now: ctx.now,
    });
    return row.id;
  });
  return getView(ctx, access, id);
}

function requireVisitor(access: CircleAccess, v: typeof visits.$inferSelect) {
  if (v.visitorMemberId !== access.membership.id) throw new AppError("forbidden", "Only the visitor can check in or out of this visit.");
}

/** "I've arrived". Self-reported; it does not prove presence. */
export async function checkIn(ctx: ServiceContext, circleId: string, visitId: string) {
  const access = await authorize(ctx, circleId, "visit.record", { write: true });
  await ctx.db.transaction(async (tx) => {
    const v = await loadForUpdate(tx, circleId, visitId);
    requireVisitor(access, v);
    if (v.status === "in_progress") return;
    if (v.status !== "planned") throw new AppError("conflict", "This visit is no longer planned.");
    if (v.plannedStart.getTime() - ctx.now.getTime() > EARLY_CHECK_IN_MINUTES * 60_000) {
      throw new AppError("conflict", "It's too early to check in for this visit.");
    }
    await tx.update(visits).set({ status: "in_progress", checkedInAt: ctx.now, updatedAt: ctx.now }).where(eq(visits.id, visitId));
    await recordAudit(tx, { circleId, actorUserId: ctx.userId, action: "visit.started", entityType: "visit", entityId: visitId, now: ctx.now });
  });
  return getView(ctx, access, visitId);
}

function clock(at: Date, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone }).format(at);
}

async function profileOf(db: DbOrTx, circleId: string) {
  const [p] = await db
    .select({ name: sql<string>`coalesce(${careProfiles.preferredName}, ${careProfiles.displayName})`, timeZone: careProfiles.timeZone })
    .from(careProfiles)
    .where(eq(careProfiles.circleId, circleId));
  return p;
}

/** Scenario C: the visitor checks out with notes, and the family gets a summary. */
export async function checkOut(ctx: ServiceContext, circleId: string, visitId: string, input: z.infer<typeof checkOutSchema>) {
  const access = await authorize(ctx, circleId, "visit.record", { write: true });
  const visit = await ctx.db.transaction(async (tx) => {
    const v = await loadForUpdate(tx, circleId, visitId);
    requireVisitor(access, v);
    if (v.status !== "in_progress") throw new AppError("conflict", "Check in before checking out.");
    const [updated] = await tx
      .update(visits)
      .set({
        status: "completed",
        checkedOutAt: ctx.now,
        observations: input.observations ?? null,
        handoverNote: input.handoverNote ?? null,
        unresolvedIssues: input.unresolvedIssues ?? null,
        updatedAt: ctx.now,
      })
      .where(eq(visits.id, visitId))
      .returning();
    await recordAudit(tx, { circleId, actorUserId: ctx.userId, action: "visit.completed", entityType: "visit", entityId: visitId, now: ctx.now });
    return updated;
  });

  const [profile, audience] = await Promise.all([profileOf(ctx.db, circleId), circleAudience(ctx.db, circleId, ctx.now)]);
  const [me] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId));
  const link = `/app/circles/${circleId}/visits`;
  const recipients = audience.filter((m) => m.userId !== ctx.userId && m.can("update.view") && m.role !== "clinician");
  await notifyUsers(
    ctx.db,
    ctx.now,
    recipients.map((r) => {
      const t = translatorFor(r.locale);
      const parts = r.can("health.view")
        ? [
            visit.unresolvedIssues && t("notif.visitSummaryIssues", { issues: visit.unresolvedIssues }),
            visit.handoverNote && t("notif.visitSummaryHandover", { handover: visit.handoverNote }),
          ].filter(Boolean)
        : [visit.observations || visit.handoverNote || visit.unresolvedIssues ? t("notif.visitSummaryHidden", { name: profile.name }) : ""];
      const vars = {
        visitor: me.name,
        name: profile.name,
        from: clock(visit.checkedInAt!, r.locale, profile.timeZone),
        to: clock(visit.checkedOutAt!, r.locale, profile.timeZone),
        details: parts.filter(Boolean).join(" ") || t("notif.visitSummaryNothing"),
        link: appUrl(link),
      };
      return {
        userId: r.userId,
        circleId,
        kind: "visit_summary",
        // Unresolved issues need someone's attention; ordinary summaries are informational.
        priority: visit.unresolvedIssues ? ("high" as const) : ("low" as const),
        title: t("notif.visitSummaryTitle", vars),
        body: t("notif.visitSummaryBody", vars),
        link,
        groupKey: `visit:${visit.id}`,
        dedupeKey: `visit_summary:${visit.id}:${r.userId}`,
        email: visit.unresolvedIssues ? { subject: t("notif.visitEmailSubject", vars), text: t("notif.visitEmailBody", vars) } : undefined,
      };
    }),
  );
  return getView(ctx, access, visitId);
}

/** "I can't make it" from the visitor (alerts the organisers), or a cancellation by an organiser. */
export async function cancelVisit(ctx: ServiceContext, circleId: string, visitId: string, input: z.infer<typeof cancelVisitSchema>) {
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  requireWritable(access);
  const visit = await ctx.db.transaction(async (tx) => {
    const v = await loadForUpdate(tx, circleId, visitId);
    const isVisitor = v.visitorMemberId === access.membership.id;
    const canOrganise = access.can("visit.record") && (access.membership.role === "admin" || access.membership.role === "family");
    if (!isVisitor && !canOrganise) throw new AppError("forbidden", "You don't have permission to do this in this care circle.");
    if (v.status !== "planned") throw new AppError("conflict", "Only planned visits can be cancelled.");
    const [updated] = await tx
      .update(visits)
      .set({ status: "cancelled", cancelReason: input.reason, cancelledBy: ctx.userId, cancelledAt: ctx.now, updatedAt: ctx.now })
      .where(eq(visits.id, visitId))
      .returning();
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: "visit.cancelled",
      entityType: "visit",
      entityId: visitId,
      metadata: { reason: input.reason, byVisitor: isVisitor },
      now: ctx.now,
    });
    return { ...updated, byVisitor: isVisitor };
  });

  // A caregiver dropping out of a visit in the next two days needs cover: tell the organisers.
  if (visit.byVisitor && visit.plannedStart.getTime() - ctx.now.getTime() < 48 * 3_600_000) {
    const [profile, audience] = await Promise.all([profileOf(ctx.db, circleId), circleAudience(ctx.db, circleId, ctx.now)]);
    const [me] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId));
    const link = `/app/circles/${circleId}/visits`;
    await notifyUsers(
      ctx.db,
      ctx.now,
      audience
        .filter((m) => m.userId !== ctx.userId && (m.role === "admin" || m.role === "family"))
        .map((r) => {
          const t = translatorFor(r.locale);
          const vars = {
            visitor: me.name,
            name: profile.name,
            when: new Intl.DateTimeFormat(r.locale, { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: profile.timeZone }).format(visit.plannedStart),
            reason: input.reason,
            link: appUrl(link),
          };
          return {
            userId: r.userId,
            circleId,
            kind: "visit_cancelled",
            priority: "high" as const,
            title: t("notif.visitCancelledTitle", vars),
            body: t("notif.visitCancelledBody", vars),
            link,
            groupKey: `visit:${visit.id}`,
            dedupeKey: `visit_cancelled:${visit.id}:${r.userId}`,
            email: { subject: t("notif.visitEmailSubject", vars), text: t("notif.visitEmailBody", vars) },
          };
        }),
    );
  }
  return getView(ctx, access, visitId);
}
