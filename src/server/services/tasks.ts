import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { careProfiles, memberships, TASK_CATEGORIES, tasks, users } from "@/server/db/schema";
import { nextOccurrence } from "@/server/domain/recurrence";
import { AppError } from "@/server/http";
import { uuidSchema } from "@/server/validation";
import { authorize, loadCircleAccess, requireWritable, type DbOrTx, type ServiceContext } from "./access";
import { recordAudit } from "./audit";
import { resolveActiveMember } from "./members";

/** People who can be given tasks: everyone who helps, and the recipient for their own errands. */
const TASK_ROLES = ["admin", "family", "caregiver", "care_recipient"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const taskFields = {
  title: z.string().trim().min(1, "Describe the task.").max(200),
  notes: optionalText(2000),
  category: z.enum(TASK_CATEGORIES),
  assigneeMemberId: z.string().nullable(),
  dueAt: z.iso.datetime({ offset: true, message: "Enter a valid date and time." }).nullable(),
  priority: z.enum(["low", "normal", "high"]),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]),
};

export const createTaskSchema = z
  .object({
    ...taskFields,
    category: taskFields.category.default("other"),
    assigneeMemberId: taskFields.assigneeMemberId.optional(),
    dueAt: taskFields.dueAt.optional(),
    priority: taskFields.priority.default("normal"),
    recurrence: taskFields.recurrence.default("none"),
  })
  .refine((v) => v.recurrence === "none" || v.dueAt, { message: "Repeating tasks need a due date.", path: ["dueAt"] });

export const updateTaskSchema = z.object({ ...taskFields, version: z.int().positive() }).partial().required({ version: true });

export const completeTaskSchema = z.object({ note: optionalText(2000) });

export const listTasksQuerySchema = z.object({
  status: z.enum(["open", "done", "all"]).default("open"),
  assignee: z.enum(["me", "unassigned", "any"]).default("any"),
});

const assigneeMember = alias(memberships, "assignee_member");
const assigneeUser = alias(users, "assignee_user");
const completer = alias(users, "completer");

function selectTasks(db: DbOrTx) {
  return db
    .select({ task: tasks, assigneeName: assigneeUser.name, completedByName: completer.name })
    .from(tasks)
    .leftJoin(assigneeMember, eq(assigneeMember.id, tasks.assigneeMemberId))
    .leftJoin(assigneeUser, eq(assigneeUser.id, assigneeMember.userId))
    .leftJoin(completer, eq(completer.id, tasks.completedBy));
}

type Row = Awaited<ReturnType<ReturnType<typeof selectTasks>["limit"]>>[number];

function serialize(r: Row) {
  const t = r.task;
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    category: t.category,
    assignee: t.assigneeMemberId ? { memberId: t.assigneeMemberId, name: r.assigneeName } : null,
    dueAt: t.dueAt,
    priority: t.priority,
    status: t.status,
    recurrence: t.recurrence,
    appointmentId: t.appointmentId,
    completedAt: t.completedAt,
    completedBy: r.completedByName,
    completionNote: t.completionNote,
    version: t.version,
    createdAt: t.createdAt,
  };
}

async function load(db: DbOrTx, circleId: string, taskId: string) {
  if (!uuidSchema.safeParse(taskId).success) throw new AppError("not_found", "Task not found.");
  const [row] = await selectTasks(db)
    .where(and(eq(tasks.id, taskId), eq(tasks.circleId, circleId)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Task not found.");
  return row;
}

export async function listTasks(ctx: ServiceContext, circleId: string, query: z.infer<typeof listTasksQuerySchema>) {
  const access = await authorize(ctx, circleId, "task.view");
  const rows = await selectTasks(ctx.db)
    .where(
      and(
        eq(tasks.circleId, circleId),
        query.status === "all" ? undefined : eq(tasks.status, query.status),
        query.assignee === "me" ? eq(tasks.assigneeMemberId, access.membership.id) : undefined,
        query.assignee === "unassigned" ? isNull(tasks.assigneeMemberId) : undefined,
      ),
    )
    .orderBy(
      ...(query.status === "done"
        ? [desc(tasks.completedAt)]
        : [asc(sql`${tasks.dueAt} is null`), asc(tasks.dueAt), desc(sql`${tasks.priority} = 'high'`), asc(tasks.createdAt)]),
    )
    .limit(200);
  return rows.map(serialize);
}

export async function getTask(ctx: ServiceContext, circleId: string, taskId: string) {
  await authorize(ctx, circleId, "task.view");
  return serialize(await load(ctx.db, circleId, taskId));
}

async function insertTask(
  db: DbOrTx,
  values: Omit<typeof tasks.$inferInsert, "createdAt" | "updatedAt">,
  audit: { userId: string; now: Date; action?: string },
) {
  const [row] = await db
    .insert(tasks)
    .values({ ...values, createdAt: audit.now, updatedAt: audit.now })
    .returning({ id: tasks.id });
  await recordAudit(db, {
    circleId: values.circleId,
    actorUserId: audit.userId,
    action: audit.action ?? "task.created",
    entityType: "task",
    entityId: row.id,
    metadata: { name: values.title },
    now: audit.now,
  });
  return row.id;
}

export async function createTask(ctx: ServiceContext, circleId: string, raw: z.input<typeof createTaskSchema>) {
  // Validate here too, so the rules (e.g. repeating tasks need a due date) hold for every caller.
  const input = createTaskSchema.parse(raw);
  await authorize(ctx, circleId, "task.manage", { write: true });
  const id = await ctx.db.transaction(async (tx) => {
    if (input.assigneeMemberId) await resolveActiveMember(tx, circleId, input.assigneeMemberId, ctx.now, [...TASK_ROLES]);
    return insertTask(
      tx,
      {
        circleId,
        title: input.title,
        notes: input.notes ?? null,
        category: input.category,
        assigneeMemberId: input.assigneeMemberId ?? null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        priority: input.priority,
        recurrence: input.recurrence,
        createdBy: ctx.userId,
      },
      { userId: ctx.userId, now: ctx.now },
    );
  });
  return getTask(ctx, circleId, id);
}

/** Follow-up tasks created when an appointment's outcome is recorded (Scenario D). */
export async function createFollowUpTasks(
  db: DbOrTx,
  input: { circleId: string; appointmentId: string; tasks: { title: string; dueAt?: string | null }[]; userId: string; now: Date },
) {
  for (const t of input.tasks) {
    await insertTask(
      db,
      {
        circleId: input.circleId,
        title: t.title,
        category: "appointment",
        dueAt: t.dueAt ? new Date(t.dueAt) : null,
        appointmentId: input.appointmentId,
        createdBy: input.userId,
      },
      { userId: input.userId, now: input.now },
    );
  }
}

export async function updateTask(ctx: ServiceContext, circleId: string, taskId: string, input: z.infer<typeof updateTaskSchema>) {
  await authorize(ctx, circleId, "task.manage", { write: true });
  await ctx.db.transaction(async (tx) => {
    const current = (await load(tx, circleId, taskId)).task;
    if (current.status !== "open") throw new AppError("conflict", "Only open tasks can be changed. Reopen it first.");
    if (input.assigneeMemberId) await resolveActiveMember(tx, circleId, input.assigneeMemberId, ctx.now, [...TASK_ROLES]);
    const recurrence = input.recurrence ?? current.recurrence;
    const dueAt = input.dueAt === undefined ? current.dueAt : input.dueAt ? new Date(input.dueAt) : null;
    if (recurrence !== "none" && !dueAt) {
      throw new AppError("validation_failed", "Some fields are invalid.", { dueAt: ["Repeating tasks need a due date."] });
    }
    const { version, ...fields } = input;
    const dueChanged = input.dueAt !== undefined && dueAt?.getTime() !== current.dueAt?.getTime();
    const assigneeChanged = input.assigneeMemberId !== undefined && input.assigneeMemberId !== current.assigneeMemberId;
    const [updated] = await tx
      .update(tasks)
      .set({
        ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
        dueAt,
        // A new due date or a new person means fresh reminders.
        ...(dueChanged || assigneeChanged ? { dueReminderSentAt: null, overdueAlertedAt: null, unassignedAlertedAt: null } : {}),
        version: version + 1,
        updatedAt: ctx.now,
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.version, version)))
      .returning({ id: tasks.id });
    if (!updated) throw new AppError("conflict", "Someone else changed this task. Reload to see their changes, then try again.");
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: assigneeChanged ? "task.reassigned" : "task.updated",
      entityType: "task",
      entityId: taskId,
      metadata: { name: current.title, fields: Object.keys(fields), from: current.assigneeMemberId, to: input.assigneeMemberId },
      now: ctx.now,
    });
  });
  return getTask(ctx, circleId, taskId);
}

/** "I'll do it" / "I can't do it after all". */
export async function claimTask(ctx: ServiceContext, circleId: string, taskId: string, action: "claim" | "release") {
  const access = await authorize(ctx, circleId, "task.complete", { write: true });
  await ctx.db.transaction(async (tx) => {
    const [current] = await tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.circleId, circleId))).for("update");
    if (!current || !uuidSchema.safeParse(taskId).success) throw new AppError("not_found", "Task not found.");
    if (current.status !== "open") throw new AppError("conflict", "This task is no longer open.");
    const mine = current.assigneeMemberId === access.membership.id;
    if (action === "claim") {
      if (current.assigneeMemberId && !mine) throw new AppError("conflict", "Someone else has already taken this task.");
      if (mine) return;
    } else if (!mine) {
      throw new AppError("conflict", "This task isn't assigned to you.");
    }
    await tx
      .update(tasks)
      .set({
        assigneeMemberId: action === "claim" ? access.membership.id : null,
        dueReminderSentAt: null,
        overdueAlertedAt: null,
        unassignedAlertedAt: null,
        version: current.version + 1,
        updatedAt: ctx.now,
      })
      .where(eq(tasks.id, taskId));
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: action === "claim" ? "task.claimed" : "task.released",
      entityType: "task",
      entityId: taskId,
      metadata: { name: current.title },
      now: ctx.now,
    });
  });
  return getTask(ctx, circleId, taskId);
}

/**
 * Marks a task done. Caregivers can complete only tasks assigned to them. Recurring tasks
 * create their next occurrence exactly once (guarded by next_task_id under a row lock).
 */
export async function completeTask(ctx: ServiceContext, circleId: string, taskId: string, input: z.infer<typeof completeTaskSchema>) {
  const access = await authorize(ctx, circleId, "task.complete", { write: true });
  let nextId: string | null = null;
  await ctx.db.transaction(async (tx) => {
    if (!uuidSchema.safeParse(taskId).success) throw new AppError("not_found", "Task not found.");
    const [current] = await tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.circleId, circleId))).for("update");
    if (!current) throw new AppError("not_found", "Task not found.");
    if (current.status === "cancelled") throw new AppError("conflict", "This task was cancelled.");
    if (current.status === "done") return;
    if (access.membership.role === "caregiver" && current.assigneeMemberId !== access.membership.id) {
      throw new AppError("forbidden", "Caregivers can complete the tasks assigned to them.");
    }
    await tx
      .update(tasks)
      .set({ status: "done", completedAt: ctx.now, completedBy: ctx.userId, completionNote: input.note ?? null, version: current.version + 1, updatedAt: ctx.now })
      .where(eq(tasks.id, taskId));
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: "task.completed",
      entityType: "task",
      entityId: taskId,
      metadata: { name: current.title },
      now: ctx.now,
    });

    if (current.recurrence !== "none" && current.dueAt && !current.nextTaskId) {
      const [profile] = await tx.select({ timeZone: careProfiles.timeZone }).from(careProfiles).where(eq(careProfiles.circleId, circleId));
      const due = nextOccurrence(current.dueAt, current.recurrence, profile.timeZone, ctx.now)!;
      // Keep the same person only if they are still an active member.
      const [assignee] = current.assigneeMemberId
        ? await tx
            .select({ id: memberships.id })
            .from(memberships)
            .where(and(eq(memberships.id, current.assigneeMemberId), eq(memberships.status, "active")))
        : [];
      nextId = await insertTask(
        tx,
        {
          circleId,
          title: current.title,
          notes: current.notes,
          category: current.category,
          assigneeMemberId: assignee?.id ?? null,
          dueAt: due,
          priority: current.priority,
          recurrence: current.recurrence,
          createdBy: current.createdBy,
        },
        { userId: ctx.userId, now: ctx.now, action: "task.recurred" },
      );
      await tx.update(tasks).set({ nextTaskId: nextId }).where(eq(tasks.id, taskId));
    }
  });
  return { task: await getTask(ctx, circleId, taskId), nextTaskId: nextId };
}

export async function setTaskStatus(ctx: ServiceContext, circleId: string, taskId: string, action: "reopen" | "cancel") {
  const access = await loadCircleAccess(ctx.db, circleId, ctx.userId, ctx.now);
  if (!access.can("task.manage")) throw new AppError("forbidden", "You don't have permission to do this in this care circle.");
  requireWritable(access);
  await ctx.db.transaction(async (tx) => {
    const current = (await load(tx, circleId, taskId)).task;
    if (action === "reopen" && current.status === "open") return;
    if (action === "cancel" && current.status !== "open") throw new AppError("conflict", "Only open tasks can be cancelled.");
    await tx
      .update(tasks)
      .set(
        action === "reopen"
          ? { status: "open", completedAt: null, completedBy: null, cancelledAt: null, version: current.version + 1, updatedAt: ctx.now }
          : { status: "cancelled", cancelledAt: ctx.now, version: current.version + 1, updatedAt: ctx.now },
      )
      .where(eq(tasks.id, taskId));
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: action === "reopen" ? "task.reopened" : "task.cancelled",
      entityType: "task",
      entityId: taskId,
      metadata: { name: current.title },
      now: ctx.now,
    });
  });
  return getTask(ctx, circleId, taskId);
}
