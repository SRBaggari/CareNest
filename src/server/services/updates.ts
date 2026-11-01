import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { careProfiles, careUpdates, users } from "@/server/db/schema";
import { AppError } from "@/server/http";
import { appUrl, circleAudience, translatorFor } from "@/server/notifications/audience";
import { uuidSchema } from "@/server/validation";
import { authorize, type CircleAccess, type ServiceContext } from "./access";
import { recordAudit } from "./audit";
import { notifyUsers } from "./notifications";

export const postUpdateSchema = z.object({
  body: z.string().trim().min(1, "Write something to share.").max(4000),
  category: z.enum(["general", "health", "mood"]).default("general"),
  important: z.boolean().default(false),
  /** Set when this update corrects one of the author's earlier updates. */
  correctsUpdateId: z.string().nullable().optional(),
});

export const listUpdatesQuerySchema = z.object({
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** Categories this member may see: health and mood follow the recipient's health-sharing choice. */
export function visibleCategories(access: Pick<CircleAccess, "can">): ("general" | "health" | "mood")[] {
  return access.can("health.view") ? ["general", "health", "mood"] : ["general"];
}

const author = alias(users, "author");

export async function listUpdates(ctx: ServiceContext, circleId: string, query: z.infer<typeof listUpdatesQuerySchema>) {
  const access = await authorize(ctx, circleId, "update.view");
  const rows = await ctx.db
    .select({
      id: careUpdates.id,
      body: careUpdates.body,
      category: careUpdates.category,
      important: careUpdates.important,
      correctsUpdateId: careUpdates.correctsUpdateId,
      createdAt: careUpdates.createdAt,
      author: { id: author.id, name: author.name },
      correctedBy: sql<string | null>`(select c.id from care_updates c where c.corrects_update_id = ${careUpdates.id} order by c.created_at desc limit 1)`,
    })
    .from(careUpdates)
    .leftJoin(author, eq(author.id, careUpdates.authorUserId))
    .where(
      and(
        eq(careUpdates.circleId, circleId),
        inArray(careUpdates.category, visibleCategories(access)),
        query.before ? lt(careUpdates.createdAt, new Date(query.before)) : undefined,
      ),
    )
    .orderBy(desc(careUpdates.createdAt))
    .limit(query.limit);
  return rows;
}

export async function postUpdate(ctx: ServiceContext, circleId: string, raw: z.input<typeof postUpdateSchema>) {
  const input = postUpdateSchema.parse(raw);
  const access = await authorize(ctx, circleId, "update.post", { write: true });
  if (input.category !== "general" && !access.can("health.view")) {
    throw new AppError("forbidden", "Health and mood notes are only shared with people who can see health details.");
  }

  const update = await ctx.db.transaction(async (tx) => {
    if (input.correctsUpdateId) {
      if (!uuidSchema.safeParse(input.correctsUpdateId).success) throw new AppError("not_found", "Update not found.");
      const [original] = await tx
        .select({ authorUserId: careUpdates.authorUserId })
        .from(careUpdates)
        .where(and(eq(careUpdates.id, input.correctsUpdateId), eq(careUpdates.circleId, circleId)));
      if (!original) throw new AppError("not_found", "Update not found.");
      if (original.authorUserId !== ctx.userId) throw new AppError("forbidden", "You can only correct your own updates.");
    }
    const [row] = await tx
      .insert(careUpdates)
      .values({
        circleId,
        authorUserId: ctx.userId,
        body: input.body,
        category: input.category,
        important: input.important,
        correctsUpdateId: input.correctsUpdateId ?? null,
        createdAt: ctx.now,
      })
      .returning();
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: input.correctsUpdateId ? "update.corrected" : "update.posted",
      entityType: "care_update",
      entityId: row.id,
      metadata: { category: input.category, important: input.important },
      now: ctx.now,
    });
    return row;
  });

  // Important updates alert people (and email them) straight away; everyday ones are low-priority
  // news: shown in the app and gathered into the evening digest email.
  {
    const [[profile], audience, [me]] = await Promise.all([
      ctx.db
        .select({ name: sql<string>`coalesce(${careProfiles.preferredName}, ${careProfiles.displayName})` })
        .from(careProfiles)
        .where(eq(careProfiles.circleId, circleId)),
      circleAudience(ctx.db, circleId, ctx.now),
      ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId)),
    ]);
    const link = `/app/circles/${circleId}/updates`;
    await notifyUsers(
      ctx.db,
      ctx.now,
      audience
        .filter((m) => m.userId !== ctx.userId && m.can("update.view") && visibleCategories(m).includes(update.category))
        .map((r) => {
          const t = translatorFor(r.locale);
          const vars = { author: me.name, name: profile.name, body: update.body.slice(0, 300), link: appUrl(link) };
          const base = { userId: r.userId, circleId, body: t("notif.updateImportantBody", vars), link, groupKey: `update:${update.id}` };
          if (!update.important) {
            return { ...base, kind: "care_update", priority: "low" as const, title: t("notif.updateTitle", vars), dedupeKey: `care_update:${update.id}:${r.userId}` };
          }
          return {
            ...base,
            kind: "important_update",
            priority: "high" as const,
            title: t("notif.updateImportantTitle", vars),
            dedupeKey: `important_update:${update.id}:${r.userId}`,
            // The email never contains the note itself.
            email: { subject: t("notif.updateEmailSubject", vars), text: t("notif.updateEmailBody", vars) },
          };
        }),
    );
  }
  return update;
}
