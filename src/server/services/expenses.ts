// Shared care costs: who paid, how a cost is split, and who owes whom. Visible to the family and the
// person receiving care (not caregivers, who may be the ones being paid). Nothing here moves money;
// a settlement only records that someone says they paid.

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { expenses, expenseShares, memberships, settlements, users } from "@/server/db/schema";
import {
  balances,
  checkCustomSplit,
  CURRENCIES,
  EXPENSE_CATEGORIES,
  FORMER_MEMBER,
  minorToDecimal,
  parseAmount,
  settleUp,
  splitEqually,
  type Share,
} from "@/server/domain/expenses";
import { toCsv } from "@/server/domain/reports";
import { addDays, localDateIn } from "@/server/domain/schedule";
import { AppError } from "@/server/http";
import { appUrl, circleAudience, translatorFor } from "@/server/notifications/audience";
import { localDateSchema, uuidSchema } from "@/server/validation";
import { authorize, type CircleAccess, type ServiceContext } from "./access";
import { recordAudit } from "./audit";
import { notifyUsers } from "./notifications";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);
const amountInput = z.union([z.string().max(20), z.number()]);

export const createExpenseSchema = z.object({
  description: z.string().trim().min(1, "Say what it was for.").max(200),
  category: z.enum(EXPENSE_CATEGORIES).default("other"),
  amount: amountInput,
  currency: z.enum(CURRENCIES),
  spentOn: localDateSchema,
  paidBy: uuidSchema,
  split: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("equal"), members: z.array(uuidSchema).min(1, "Choose who shares this cost.").max(30) }),
    z.object({ mode: z.literal("custom"), shares: z.array(z.object({ memberId: uuidSchema, amount: amountInput })).min(1).max(30) }),
    z.object({ mode: z.literal("payer_only") }),
  ]),
  note: optionalText(500),
});

export const recordSettlementSchema = z.object({
  fromMember: uuidSchema,
  toMember: uuidSchema,
  amount: amountInput,
  currency: z.enum(CURRENCIES),
  paidOn: localDateSchema,
  note: optionalText(500),
});

/** Older costs belong in a spreadsheet, not a running family balance. */
const MAX_PAST_DAYS = 3 * 366;

/** The people who can take part in shared costs: active members who can see them. */
async function costSharers(ctx: ServiceContext, circleId: string) {
  return (await circleAudience(ctx.db, circleId, ctx.now)).filter((m) => m.can("expense.view"));
}

/** Everyone who has ever been in the circle, by membership, for names in the history. */
async function memberNames(ctx: ServiceContext, circleId: string) {
  const rows = await ctx.db.select({ id: memberships.id, name: users.name }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.circleId, circleId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function createExpense(ctx: ServiceContext, circleId: string, raw: z.input<typeof createExpenseSchema>) {
  const input = createExpenseSchema.parse(raw);
  const access = await authorize(ctx, circleId, "expense.record", { write: true });
  const sharers = await costSharers(ctx, circleId);
  const allowed = new Set(sharers.map((m) => m.memberId));
  const details: Record<string, string[]> = {};
  const amountMinor = parseAmount(input.amount);
  if (amountMinor === null) details.amount = ["Enter an amount like 1200 or 1200.50."];
  dateRule(access, ctx.now, "spentOn", input.spentOn, details);
  if (!allowed.has(input.paidBy)) details.paidBy = ["Choose someone in this circle who shares costs."];

  let shares: Share[] = [];
  if (amountMinor !== null) {
    if (input.split.mode === "payer_only") shares = [{ memberId: input.paidBy, amountMinor }];
    else if (input.split.mode === "equal") shares = splitEqually(amountMinor, input.split.members, input.paidBy);
    else {
      const parsed = input.split.shares.map((s) => ({ memberId: s.memberId, amountMinor: parseAmount(s.amount) ?? 0 }));
      const problem = checkCustomSplit(amountMinor, parsed);
      if (problem) details.split = [problem];
      shares = parsed;
    }
    if (shares.some((s) => !allowed.has(s.memberId))) details.split = ["Everyone sharing a cost must be in this circle and able to see costs."];
  }
  if (Object.keys(details).length > 0) throw new AppError("validation_failed", "Some fields are invalid.", details);

  const expense = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(expenses)
      .values({
        circleId,
        description: input.description,
        category: input.category,
        amountMinor: amountMinor!,
        currency: input.currency,
        spentOn: input.spentOn,
        paidBy: input.paidBy,
        splitMode: input.split.mode,
        note: input.note,
        createdBy: ctx.userId,
        createdAt: ctx.now,
      })
      .returning();
    await tx.insert(expenseShares).values(shares.map((s) => ({ expenseId: row.id, memberId: s.memberId, amountMinor: s.amountMinor })));
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: "expense.added",
      entityType: "expense",
      entityId: row.id,
      metadata: { description: row.description, amountMinor: row.amountMinor, currency: row.currency },
      now: ctx.now,
    });
    return row;
  });

  // The people sharing the cost hear about it in the app and the evening summary (low priority).
  const [me] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId));
  const shareOf = new Map(shares.map((s) => [s.memberId, s.amountMinor]));
  const link = `/app/circles/${circleId}/expenses`;
  await notifyUsers(
    ctx.db,
    ctx.now,
    sharers
      .filter((m) => m.userId !== ctx.userId && shareOf.has(m.memberId) && m.memberId !== input.paidBy)
      .map((m) => {
        const t = translatorFor(m.locale);
        const money = (minor: number) => new Intl.NumberFormat(m.locale, { style: "currency", currency: expense.currency }).format(minor / 100);
        const vars = { name: me?.name ?? "", what: expense.description, amount: money(expense.amountMinor), share: money(shareOf.get(m.memberId)!), link: appUrl(link) };
        return {
          userId: m.userId,
          circleId,
          kind: "expense_added",
          priority: "low" as const,
          title: t("notif.expenseTitle", vars),
          body: t("notif.expenseBody", vars),
          link,
          groupKey: `expense:${expense.id}`,
          dedupeKey: `expense_added:${expense.id}:${m.userId}`,
        };
      }),
  );
  return expense;
}

function dateRule(access: CircleAccess, now: Date, field: string, date: string, details: Record<string, string[]>) {
  const today = localDateIn(access.profile.timeZone, now);
  if (date > today) details[field] = ["That date hasn't happened yet."];
  else if (date < addDays(today, -MAX_PAST_DAYS)) details[field] = ["That's more than three years ago."];
}

/** Newest first, with each person's part and names (a deleted account shows as a former member). */
export async function listExpenses(ctx: ServiceContext, circleId: string, options: { limit?: number } = {}) {
  await authorize(ctx, circleId, "expense.view");
  const [rows, names] = await Promise.all([
    ctx.db
      .select()
      .from(expenses)
      .where(and(eq(expenses.circleId, circleId), isNull(expenses.removedAt)))
      .orderBy(desc(expenses.spentOn), desc(expenses.createdAt))
      .limit(Math.min(options.limit ?? 100, 500)),
    memberNames(ctx, circleId),
  ]);
  const shares = rows.length ? await ctx.db.select().from(expenseShares).where(inArray(expenseShares.expenseId, rows.map((r) => r.id))) : [];
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    category: r.category,
    amountMinor: r.amountMinor,
    currency: r.currency,
    spentOn: r.spentOn,
    splitMode: r.splitMode,
    note: r.note,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    paidBy: { memberId: r.paidBy, name: nameOf(r.paidBy) },
    shares: shares.filter((s) => s.expenseId === r.id).map((s) => ({ memberId: s.memberId, name: nameOf(s.memberId), amountMinor: s.amountMinor })),
  }));
}

export async function listSettlements(ctx: ServiceContext, circleId: string) {
  await authorize(ctx, circleId, "expense.view");
  const [rows, names] = await Promise.all([
    ctx.db
      .select()
      .from(settlements)
      .where(and(eq(settlements.circleId, circleId), isNull(settlements.removedAt)))
      .orderBy(desc(settlements.paidOn), desc(settlements.createdAt))
      .limit(200),
    memberNames(ctx, circleId),
  ]);
  return rows.map((r) => ({
    id: r.id,
    amountMinor: r.amountMinor,
    currency: r.currency,
    paidOn: r.paidOn,
    note: r.note,
    createdBy: r.createdBy,
    from: { memberId: r.fromMember, name: r.fromMember ? (names.get(r.fromMember) ?? null) : null },
    to: { memberId: r.toMember, name: r.toMember ? (names.get(r.toMember) ?? null) : null },
  }));
}

/** Per currency: where everyone stands, and the payments that would settle it. */
export async function expenseBalances(ctx: ServiceContext, circleId: string) {
  const access = await authorize(ctx, circleId, "expense.view");
  const [rows, shares, paid, names] = await Promise.all([
    ctx.db.select({ id: expenses.id, paidBy: expenses.paidBy, amountMinor: expenses.amountMinor, currency: expenses.currency }).from(expenses).where(and(eq(expenses.circleId, circleId), isNull(expenses.removedAt))),
    ctx.db
      .select({ expenseId: expenseShares.expenseId, memberId: expenseShares.memberId, amountMinor: expenseShares.amountMinor })
      .from(expenseShares)
      .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
      .where(and(eq(expenses.circleId, circleId), isNull(expenses.removedAt))),
    ctx.db.select().from(settlements).where(and(eq(settlements.circleId, circleId), isNull(settlements.removedAt))),
    memberNames(ctx, circleId),
  ]);
  const byCurrency = balances({
    expenses: rows.map((e) => ({ ...e, shares: shares.filter((s) => s.expenseId === e.id) })),
    settlements: paid,
  });
  const nameOf = (id: string) => (id === FORMER_MEMBER ? null : (names.get(id) ?? null));
  return {
    myMemberId: access.membership.id,
    currencies: [...byCurrency].map(([currency, people]) => ({
      currency,
      people: [...people].map(([memberId, amountMinor]) => ({ memberId: memberId === FORMER_MEMBER ? null : memberId, name: nameOf(memberId), amountMinor })).sort((a, b) => b.amountMinor - a.amountMinor),
      transfers: settleUp(people).map((t) => ({ ...t, fromName: nameOf(t.from), toName: nameOf(t.to) })),
    })),
  };
}

export async function recordSettlement(ctx: ServiceContext, circleId: string, raw: z.input<typeof recordSettlementSchema>) {
  const input = recordSettlementSchema.parse(raw);
  const access = await authorize(ctx, circleId, "expense.record", { write: true });
  const sharers = await costSharers(ctx, circleId);
  const allowed = new Set(sharers.map((m) => m.memberId));
  const details: Record<string, string[]> = {};
  const amountMinor = parseAmount(input.amount);
  if (amountMinor === null) details.amount = ["Enter an amount like 1200 or 1200.50."];
  dateRule(access, ctx.now, "paidOn", input.paidOn, details);
  if (!allowed.has(input.fromMember)) details.fromMember = ["Choose someone in this circle who shares costs."];
  if (!allowed.has(input.toMember)) details.toMember = ["Choose someone in this circle who shares costs."];
  if (input.fromMember === input.toMember) details.toMember = ["Choose two different people."];
  if (Object.keys(details).length > 0) throw new AppError("validation_failed", "Some fields are invalid.", details);

  const settlement = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(settlements)
      .values({ circleId, fromMember: input.fromMember, toMember: input.toMember, amountMinor: amountMinor!, currency: input.currency, paidOn: input.paidOn, note: input.note, createdBy: ctx.userId, createdAt: ctx.now })
      .returning();
    await recordAudit(tx, { circleId, actorUserId: ctx.userId, action: "expense.settlement_recorded", entityType: "settlement", entityId: row.id, metadata: { amountMinor: row.amountMinor, currency: row.currency }, now: ctx.now });
    return row;
  });

  const [me] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId));
  const names = await memberNames(ctx, circleId);
  const link = `/app/circles/${circleId}/expenses`;
  await notifyUsers(
    ctx.db,
    ctx.now,
    sharers
      .filter((m) => m.userId !== ctx.userId && (m.memberId === input.fromMember || m.memberId === input.toMember))
      .map((m) => {
        const t = translatorFor(m.locale);
        const vars = {
          name: me?.name ?? "",
          from: names.get(input.fromMember) ?? "",
          to: names.get(input.toMember) ?? "",
          amount: new Intl.NumberFormat(m.locale, { style: "currency", currency: settlement.currency }).format(settlement.amountMinor / 100),
          link: appUrl(link),
        };
        return {
          userId: m.userId,
          circleId,
          kind: "settlement_recorded",
          priority: "low" as const,
          title: t("notif.settlementTitle", vars),
          body: t("notif.settlementBody", vars),
          link,
          groupKey: `settlement:${settlement.id}`,
          dedupeKey: `settlement_recorded:${settlement.id}:${m.userId}`,
        };
      }),
  );
  return settlement;
}

/** The person who added it, or someone who manages the circle, can remove an entry; it stays in the activity log. */
async function removeEntry(ctx: ServiceContext, circleId: string, id: string, kind: "expense" | "settlement") {
  const access = await authorize(ctx, circleId, "expense.record", { write: true });
  if (!uuidSchema.safeParse(id).success) throw new AppError("not_found", "Not found.");
  const table = kind === "expense" ? expenses : settlements;
  const [row] = await ctx.db
    .select({ id: table.id, createdBy: table.createdBy, amountMinor: table.amountMinor, currency: table.currency })
    .from(table)
    .where(and(eq(table.id, id), eq(table.circleId, circleId), isNull(table.removedAt)));
  if (!row) throw new AppError("not_found", kind === "expense" ? "Expense not found." : "Payment not found.");
  if (row.createdBy !== ctx.userId && !access.can("circle.manage")) throw new AppError("forbidden", "Only the person who added this, or someone who manages the circle, can remove it.");
  await ctx.db.transaction(async (tx) => {
    await tx.update(table).set({ removedAt: ctx.now, removedBy: ctx.userId }).where(eq(table.id, id));
    await recordAudit(tx, {
      circleId,
      actorUserId: ctx.userId,
      action: kind === "expense" ? "expense.removed" : "expense.settlement_removed",
      entityType: kind,
      entityId: id,
      metadata: { amountMinor: row.amountMinor, currency: row.currency },
      now: ctx.now,
    });
  });
}

export const removeExpense = (ctx: ServiceContext, circleId: string, id: string) => removeEntry(ctx, circleId, id, "expense");
export const removeSettlement = (ctx: ServiceContext, circleId: string, id: string) => removeEntry(ctx, circleId, id, "settlement");

/** Every expense and payment as CSV. Column names are stable identifiers, not prose. */
export async function expensesCsv(ctx: ServiceContext, circleId: string) {
  const [list, paid] = await Promise.all([listExpenses(ctx, circleId, { limit: 500 }), listSettlements(ctx, circleId)]);
  const who = (p: { name: string | null }) => p.name ?? "former member";
  const rows = [
    ["date", "type", "description", "category", "amount", "currency", "paid_by", "paid_to", "split", "shares", "note"],
    ...list.map((e) => [e.spentOn, "expense", e.description, e.category, minorToDecimal(e.amountMinor), e.currency, who(e.paidBy), null, e.splitMode, e.shares.map((s) => `${who(s)} ${minorToDecimal(s.amountMinor)}`).join("; "), e.note]),
    ...paid.map((s) => [s.paidOn, "payment", null, null, minorToDecimal(s.amountMinor), s.currency, who(s.from), who(s.to), null, null, s.note]),
  ];
  return toCsv(rows);
}

/** The people a cost can be paid by or shared with, for forms. */
export async function costSharerList(ctx: ServiceContext, circleId: string) {
  const access = await authorize(ctx, circleId, "expense.view");
  const [sharers, names] = await Promise.all([costSharers(ctx, circleId), memberNames(ctx, circleId)]);
  return {
    myMemberId: access.membership.id,
    people: sharers.map((m) => ({ memberId: m.memberId, name: names.get(m.memberId) ?? "" })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
