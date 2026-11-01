// Requests for help ("I need help") and the family alert sequence.
//
// Safety rules: CareNest never contacts emergency services and never says it did; every alert
// tells people to call the local emergency number. Delivery, "seen" and acknowledgement are
// tracked separately and shown, so failures and silence are visible rather than hidden.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { assistanceRequests, careProfiles, emailOutbox, emergencyContacts, memberships, notifications, users } from "@/server/db/schema";
import { AppError } from "@/server/http";
import { appUrl, circleAudience, translatorFor, type AudienceMember } from "@/server/notifications/audience";
import { emailDeliveryConfigured } from "@/server/notifications/email";
import { uuidSchema } from "@/server/validation";
import { authorize, loadCircleAccess, requireWritable, type DbOrTx, type ServiceContext } from "./access";
import { recordAudit } from "./audit";
import { notifyUsers } from "./notifications";

/** Minutes without anyone responding before the next tier is alerted. */
export const ESCALATION_MINUTES = 5;

export const raiseAssistanceSchema = z.object({
  message: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  practice: z.boolean().default(false),
  /** Sent only if the person ticked "share my location" for this alert. */
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracyMeters: z.number().min(0).max(100_000).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const resolveSchema = z.object({ note: z.string().trim().min(1, "Say briefly what happened.").max(1000) });

type Request = typeof assistanceRequests.$inferSelect;

/**
 * The alert sequence: tier-1 contacts, then tier 2, then tier 3 (each tier = emergency contacts
 * linked to circle members), then everyone else who can see emergencies, then a final repeat to
 * everyone. With no tiers configured, everyone is alerted at once. The raiser is never alerted.
 */
export async function alertSteps(db: DbOrTx, circleId: string, now: Date, raisedBy: string | null): Promise<AudienceMember[][]> {
  const audience = (await circleAudience(db, circleId, now)).filter((m) => m.can("emergency.view") && m.userId !== raisedBy);
  const contacts = await db
    .select({ memberId: emergencyContacts.memberId, tier: emergencyContacts.tier })
    .from(emergencyContacts)
    .where(eq(emergencyContacts.circleId, circleId));
  const byMember = new Map(audience.map((m) => [m.memberId, m]));
  const used = new Set<string>();
  const steps: AudienceMember[][] = [];
  for (const tier of [1, 2, 3]) {
    const step = contacts
      .filter((c) => c.tier === tier && c.memberId && byMember.has(c.memberId) && !used.has(c.memberId))
      .map((c) => {
        used.add(c.memberId!);
        return byMember.get(c.memberId!)!;
      });
    if (step.length > 0) steps.push(step);
  }
  const rest = audience.filter((m) => !used.has(m.memberId));
  if (rest.length > 0) steps.push(rest);
  if (audience.length > 0) steps.push(audience); // final repeat to everyone
  return steps;
}

async function context(db: DbOrTx, request: Request) {
  const [[profile], raiser] = await Promise.all([
    db
      .select({ name: sql<string>`coalesce(${careProfiles.preferredName}, ${careProfiles.displayName})`, number: careProfiles.emergencyNumber, linkedUserId: careProfiles.linkedUserId })
      .from(careProfiles)
      .where(eq(careProfiles.circleId, request.circleId)),
    request.raisedBy ? db.select({ name: users.name }).from(users).where(eq(users.id, request.raisedBy)) : Promise.resolve([]),
  ]);
  return { profile, raiserName: raiser[0]?.name ?? null };
}

/** Sends one step of the sequence. `repeat` marks the final "still no response" round. */
async function alertStep(db: DbOrTx, request: Request, members: AudienceMember[], now: Date, step: number, repeat: boolean) {
  const { profile, raiserName } = await context(db, request);
  const link = `/app/circles/${request.circleId}/emergency/${request.id}`;
  const selfRaised = request.raisedBy !== null && request.raisedBy === profile.linkedUserId;
  await notifyUsers(
    db,
    now,
    members.map((r) => {
      const t = translatorFor(r.locale);
      const practice = request.isPractice ? t("notif.assistPractice") : "";
      const vars = {
        name: profile.name,
        who: raiserName ?? profile.name,
        number: profile.number,
        link: appUrl(link),
        message: request.message ? t("notif.assistMessage", { message: request.message }) : "",
        location: request.location
          ? t("notif.assistLocation", { link: `https://www.openstreetmap.org/?mlat=${request.location.latitude}&mlon=${request.location.longitude}#map=17/${request.location.latitude}/${request.location.longitude}` })
          : "",
      };
      const title = repeat ? t("notif.assistRepeatTitle", vars) : t(selfRaised ? "notif.assistTitleSelf" : "notif.assistTitle", vars);
      return {
        userId: r.userId,
        circleId: request.circleId,
        kind: "assistance_alert",
        priority: "critical" as const,
        title: practice + title,
        body: t("notif.assistBody", { ...vars, message: vars.message, location: vars.location }),
        link,
        groupKey: `assist:${request.id}`,
        dedupeKey: `assist:${request.id}:${repeat ? "repeat" : step}:${r.userId}`,
        email: { subject: practice + t("notif.assistEmailSubject", vars), text: t("notif.assistEmailBody", vars) },
      };
    }),
  );
}

/** Everyone who has been alerted about a request so far (to tell them it's handled). */
async function alertedUserIds(db: DbOrTx, requestId: string) {
  const rows = await db
    .selectDistinct({ userId: notifications.userId })
    .from(notifications)
    .where(and(eq(notifications.groupKey, `assist:${requestId}`), eq(notifications.kind, "assistance_alert")));
  return rows.map((r) => r.userId);
}

async function followUp(db: DbOrTx, request: Request, actorUserId: string, kind: "ack" | "resolved" | "cancelled", now: Date, note?: string) {
  const ids = new Set(await alertedUserIds(db, request.id));
  if (request.raisedBy) ids.add(request.raisedBy);
  ids.delete(actorUserId);
  if (ids.size === 0) return;
  const { profile } = await context(db, request);
  const [actor] = await db.select({ name: users.name }).from(users).where(eq(users.id, actorUserId));
  const audience = (await circleAudience(db, request.circleId, now)).filter((m) => ids.has(m.userId));
  const link = `/app/circles/${request.circleId}/emergency/${request.id}`;
  const keys = { ack: ["notif.assistAckTitle", "notif.assistAckBody"], resolved: ["notif.assistResolvedTitle", "notif.assistResolvedBody"], cancelled: ["notif.assistCancelledTitle", "notif.assistCancelledBody"] }[kind];
  await notifyUsers(
    db,
    now,
    audience.map((r) => {
      const t = translatorFor(r.locale);
      const vars = { name: profile.name, responder: actor.name, note: note ?? "" };
      return {
        userId: r.userId,
        circleId: request.circleId,
        kind: `assistance_${kind}`,
        priority: "high" as const,
        title: (request.isPractice ? t("notif.assistPractice") : "") + t(keys[0], vars),
        body: t(keys[1], vars),
        link,
        groupKey: `assist:${request.id}`,
        dedupeKey: `assist_${kind}:${request.id}:${r.userId}`,
      };
    }),
  );
}

async function load(db: DbOrTx, circleId: string, requestId: string, lock = false) {
  if (!uuidSchema.safeParse(requestId).success) throw new AppError("not_found", "Request not found.");
  const q = db.select().from(assistanceRequests).where(and(eq(assistanceRequests.id, requestId), eq(assistanceRequests.circleId, circleId)));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw new AppError("not_found", "Request not found.");
  return row;
}

/**
 * "I need help". If a real request is already open, it is returned instead of starting a
 * second alarm (people press the button more than once when frightened).
 */
export async function raiseAssistance(ctx: ServiceContext, circleId: string, raw: z.input<typeof raiseAssistanceSchema>) {
  const input = raiseAssistanceSchema.parse(raw);
  await authorize(ctx, circleId, "emergency.raise", { write: true });
  const { request, created } = await ctx.db.transaction(async (tx) => {
    if (!input.practice) {
      const [open] = await tx
        .select()
        .from(assistanceRequests)
        .where(and(eq(assistanceRequests.circleId, circleId), eq(assistanceRequests.isPractice, false), inArray(assistanceRequests.status, ["open", "acknowledged"])))
        .for("update");
      if (open) return { request: open, created: false };
    }
    const [row] = await tx
      .insert(assistanceRequests)
      .values({
        circleId,
        raisedBy: ctx.userId,
        message: input.message ?? null,
        isPractice: input.practice,
        location: input.location ? { ...input.location, accuracyMeters: input.location.accuracyMeters ?? null } : null,
        createdAt: ctx.now,
      })
      .returning();
    await recordAudit(tx, { circleId, actorUserId: ctx.userId, action: "assistance.raised", entityType: "assistance_request", entityId: row.id, metadata: { practice: input.practice }, now: ctx.now });
    return { request: row, created: true };
  });

  if (created) {
    const steps = await alertSteps(ctx.db, circleId, ctx.now, ctx.userId);
    if (steps.length > 0) await alertStep(ctx.db, request, steps[0], ctx.now, 0, false);
    // Practice alerts reach only the first step and never escalate.
    const next = !request.isPractice && steps.length > 1 ? new Date(ctx.now.getTime() + ESCALATION_MINUTES * 60_000) : null;
    await ctx.db.update(assistanceRequests).set({ nextEscalationAt: next }).where(eq(assistanceRequests.id, request.id));
  }
  return { ...(await getAssistance(ctx, circleId, request.id)), alreadyOpen: !created };
}

/**
 * Worker step: alert the next tier for requests nobody has responded to. Claimed with a
 * conditional update on the current step, so overlapping ticks can't send a step twice.
 */
export async function escalateAssistance(db: DbOrTx, now: Date) {
  const due = await db
    .select()
    .from(assistanceRequests)
    .where(and(eq(assistanceRequests.status, "open"), sql`${assistanceRequests.nextEscalationAt} <= ${now.toISOString()}::timestamptz`));
  let sent = 0;
  for (const r of due) {
    const steps = await alertSteps(db, r.circleId, now, r.raisedBy);
    const step = r.escalationStep + 1;
    const next = step + 1 < steps.length ? new Date(now.getTime() + ESCALATION_MINUTES * 60_000) : null;
    const [claimed] = await db
      .update(assistanceRequests)
      .set({ escalationStep: step, nextEscalationAt: next })
      .where(and(eq(assistanceRequests.id, r.id), eq(assistanceRequests.escalationStep, r.escalationStep), eq(assistanceRequests.status, "open")))
      .returning();
    if (!claimed || step >= steps.length) continue;
    await alertStep(db, claimed, steps[step], now, step, step === steps.length - 1);
    sent++;
  }
  return sent;
}

/** "I'm responding": stops escalation and tells everyone alerted so far. */
export async function acknowledgeAssistance(ctx: ServiceContext, circleId: string, requestId: string) {
  await authorize(ctx, circleId, "emergency.raise", { write: true });
  const changed = await ctx.db.transaction(async (tx) => {
    const r = await load(tx, circleId, requestId, true);
    if (r.status !== "open") {
      if (r.status === "acknowledged") return null;
      throw new AppError("conflict", "This request is already closed.");
    }
    const [updated] = await tx
      .update(assistanceRequests)
      .set({ status: "acknowledged", acknowledgedAt: ctx.now, acknowledgedBy: ctx.userId, nextEscalationAt: null })
      .where(eq(assistanceRequests.id, requestId))
      .returning();
    await recordAudit(tx, { circleId, actorUserId: ctx.userId, action: "assistance.acknowledged", entityType: "assistance_request", entityId: requestId, now: ctx.now });
    return updated;
  });
  if (changed) await followUp(ctx.db, changed, ctx.userId, "ack", ctx.now);
  return getAssistance(ctx, circleId, requestId);
}

export async function resolveAssistance(ctx: ServiceContext, circleId: string, requestId: string, input: z.infer<typeof resolveSchema>) {
  await authorize(ctx, circleId, "emergency.raise", { write: true });
  const updated = await ctx.db.transaction(async (tx) => {
    const r = await load(tx, circleId, requestId, true);
    if (r.status === "resolved" || r.status === "cancelled") throw new AppError("conflict", "This request is already closed.");
    const [u] = await tx
      .update(assistanceRequests)
      .set({
        status: "resolved",
        resolvedAt: ctx.now,
        resolvedBy: ctx.userId,
        resolutionNote: input.note,
        nextEscalationAt: null,
        acknowledgedAt: r.acknowledgedAt ?? ctx.now,
        acknowledgedBy: r.acknowledgedBy ?? ctx.userId,
      })
      .where(eq(assistanceRequests.id, requestId))
      .returning();
    await recordAudit(tx, { circleId, actorUserId: ctx.userId, action: "assistance.resolved", entityType: "assistance_request", entityId: requestId, metadata: { note: input.note }, now: ctx.now });
    return u;
  });
  await followUp(ctx.db, updated, ctx.userId, "resolved", ctx.now, input.note);
  return getAssistance(ctx, circleId, requestId);
}

/** False alarm: the person who raised it, or an admin, can cancel. */
export async function cancelAssistance(ctx: ServiceContext, circleId: string, requestId: string) {
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  requireWritable(access);
  const updated = await ctx.db.transaction(async (tx) => {
    const r = await load(tx, circleId, requestId, true);
    if (r.raisedBy !== ctx.userId && access.membership.role !== "admin") throw new AppError("forbidden", "Only the person who asked for help or an admin can cancel it.");
    if (r.status === "resolved" || r.status === "cancelled") throw new AppError("conflict", "This request is already closed.");
    const [u] = await tx
      .update(assistanceRequests)
      .set({ status: "cancelled", resolvedAt: ctx.now, resolvedBy: ctx.userId, nextEscalationAt: null })
      .where(eq(assistanceRequests.id, requestId))
      .returning();
    await recordAudit(tx, { circleId, actorUserId: ctx.userId, action: "assistance.cancelled", entityType: "assistance_request", entityId: requestId, now: ctx.now });
    return u;
  });
  await followUp(ctx.db, updated, ctx.userId, "cancelled", ctx.now);
  return getAssistance(ctx, circleId, requestId);
}

const raiser = alias(users, "raiser");
const acker = alias(users, "acker");
const resolver = alias(users, "resolver");

/** Request detail with a per-person delivery report, so silence and failures are visible. */
export async function getAssistance(ctx: ServiceContext, circleId: string, requestId: string) {
  await authorize(ctx, circleId, "emergency.view");
  if (!uuidSchema.safeParse(requestId).success) throw new AppError("not_found", "Request not found.");
  const [row] = await ctx.db
    .select({ r: assistanceRequests, raisedByName: raiser.name, acknowledgedByName: acker.name, resolvedByName: resolver.name })
    .from(assistanceRequests)
    .leftJoin(raiser, eq(raiser.id, assistanceRequests.raisedBy))
    .leftJoin(acker, eq(acker.id, assistanceRequests.acknowledgedBy))
    .leftJoin(resolver, eq(resolver.id, assistanceRequests.resolvedBy))
    .where(and(eq(assistanceRequests.id, requestId), eq(assistanceRequests.circleId, circleId)));
  if (!row) throw new AppError("not_found", "Request not found.");

  const deliveries = await ctx.db
    .select({
      userId: notifications.userId,
      name: users.name,
      alertedAt: notifications.createdAt,
      seenAt: notifications.readAt,
      emailStatus: emailOutbox.status,
      repeat: sql<boolean>`${notifications.dedupeKey} like '%:repeat:%'`,
    })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .leftJoin(emailOutbox, eq(emailOutbox.notificationId, notifications.id))
    .where(and(eq(notifications.groupKey, `assist:${requestId}`), eq(notifications.kind, "assistance_alert")))
    .orderBy(notifications.createdAt);

  // One line per person: first alert time, whether any alert was seen, latest email state.
  const people = new Map<string, { userId: string; name: string; alertedAt: Date; seenAt: Date | null; emailStatus: string | null; alerts: number }>();
  for (const d of deliveries) {
    const p = people.get(d.userId);
    if (!p) people.set(d.userId, { userId: d.userId, name: d.name, alertedAt: d.alertedAt, seenAt: d.seenAt, emailStatus: d.emailStatus, alerts: 1 });
    else {
      p.alerts++;
      p.seenAt = p.seenAt ?? d.seenAt;
      p.emailStatus = d.emailStatus ?? p.emailStatus;
    }
  }

  const contactsWithoutAlerts = await ctx.db
    .select({ name: emergencyContacts.name, phone: emergencyContacts.phone, relationship: emergencyContacts.relationship, tier: emergencyContacts.tier })
    .from(emergencyContacts)
    .leftJoin(memberships, eq(memberships.id, emergencyContacts.memberId))
    .where(and(eq(emergencyContacts.circleId, circleId), sql`(${emergencyContacts.memberId} is null or ${memberships.status} <> 'active')`))
    .orderBy(emergencyContacts.tier);

  const r = row.r;
  return {
    id: r.id,
    status: r.status,
    isPractice: r.isPractice,
    message: r.message,
    location: r.location,
    raisedBy: row.raisedByName,
    raisedById: r.raisedBy,
    raisedAt: r.createdAt,
    acknowledgedBy: row.acknowledgedByName,
    acknowledgedAt: r.acknowledgedAt,
    resolvedBy: row.resolvedByName,
    resolvedAt: r.resolvedAt,
    resolutionNote: r.resolutionNote,
    escalationStep: r.escalationStep,
    nextEscalationAt: r.nextEscalationAt,
    deliveries: [...people.values()],
    /** People to phone by hand: CareNest has no SMS, so they get no automatic alert. */
    contactsWithoutAlerts,
    emailConfigured: emailDeliveryConfigured(),
  };
}

export async function listAssistance(ctx: ServiceContext, circleId: string) {
  await authorize(ctx, circleId, "emergency.view");
  return ctx.db
    .select({
      id: assistanceRequests.id,
      status: assistanceRequests.status,
      isPractice: assistanceRequests.isPractice,
      message: assistanceRequests.message,
      createdAt: assistanceRequests.createdAt,
      raisedBy: raiser.name,
    })
    .from(assistanceRequests)
    .leftJoin(raiser, eq(raiser.id, assistanceRequests.raisedBy))
    .where(eq(assistanceRequests.circleId, circleId))
    .orderBy(desc(assistanceRequests.createdAt))
    .limit(20);
}
