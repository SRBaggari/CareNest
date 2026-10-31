import { and, desc, eq, lt } from "drizzle-orm";
import { auditEvents, users } from "@/server/db/schema";
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
export async function listAuditEvents(ctx: ServiceContext, circleId: string, options: { before?: Date; limit?: number } = {}) {
  await authorize(ctx, circleId, "audit.view");
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
    .where(
      options.before
        ? and(eq(auditEvents.circleId, circleId), lt(auditEvents.createdAt, options.before))
        : eq(auditEvents.circleId, circleId),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
}
