import { and, desc, eq, lt, notLike } from "drizzle-orm";
import { auditEvents, users } from "@/server/db/schema";
import type { Capability } from "@/server/auth/permissions";
import { authorize, type DbOrTx, type ServiceContext } from "./access";

export type AuditInput = {
  circleId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  now: Date;
};

/** Appends an audit event. Call inside the same transaction as the change it records. */
export async function recordAudit(db: DbOrTx, input: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    circleId: input.circleId,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: input.metadata ?? {},
    createdAt: input.now,
  });
}

/** Newest first, paginated by `before` (created_at cursor). */
/**
 * Entries about a kind of record follow the same sharing choice as the records: "added the medicine
 * Metformin" would otherwise tell an admin what the person receiving care chose not to share.
 */
const AUDIT_CATEGORY_CAPABILITY: [prefix: string, capability: Capability][] = [
  ["medication", "medication.view"],
  ["dose", "medication.view"],
  ["appointment", "appointment.view"],
  ["measurement", "health.view"],
  ["document", "health.view"],
  ["expense", "expense.view"],
];

export async function listAuditEvents(ctx: ServiceContext, circleId: string, options: { before?: Date; limit?: number } = {}) {
  const access = await authorize(ctx, circleId, "audit.view");
  const hidden = AUDIT_CATEGORY_CAPABILITY.filter(([, capability]) => !access.can(capability)).map(([prefix]) => notLike(auditEvents.action, `${prefix}.%`));
  const limit = Math.min(options.limit ?? 50, 200);
  return ctx.db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      metadata: auditEvents.metadata,
      createdAt: auditEvents.createdAt,
      actor: { id: users.id, name: users.name },
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(and(eq(auditEvents.circleId, circleId), options.before ? lt(auditEvents.createdAt, options.before) : undefined, ...hidden))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
}
