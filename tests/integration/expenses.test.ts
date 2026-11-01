import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as exportRoute } from "@/app/api/v1/circles/[circleId]/expenses/export/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/circles/[circleId]/expenses/route";
import { notifications, users } from "@/server/db/schema";
import { listAuditEvents } from "@/server/services/audit";
import { exportCircle } from "@/server/services/data-rights";
import { createExpense, expenseBalances, expensesCsv, listExpenses, recordSettlement, removeExpense, removeSettlement } from "@/server/services/expenses";
import { createTeam } from "../helpers/circles";
import { setupTestDb } from "../helpers/db";
import { setupFakeEmail } from "../helpers/email";
import { apiRequest, params } from "../helpers/http";
import { signUp } from "../helpers/users";

const db = setupTestDb();
setupFakeEmail();
const NOW = new Date("2026-11-14T12:00:00+05:30");
const TODAY = "2026-11-14";

async function family() {
  const team = await createTeam(db());
  const { admin, elder, family: ravi, as } = team;
  const add = (by: { id: string }, input: Record<string, unknown>) =>
    createExpense(as(by, NOW), team.circle.id, { category: "medicine", currency: "INR", spentOn: TODAY, ...input } as Parameters<typeof createExpense>[2]);
  return { ...team, ravi, add, members: [admin.memberId, elder.memberId, ravi.memberId] };
}

describe("shared care costs", () => {
  it("splits a cost equally, the payer absorbing the odd paisa, and works out who owes whom", async () => {
    const { admin, ravi, elder, circle, as, add, members } = await family();
    const expense = await add(admin, { description: "October physiotherapy", amount: "1000", paidBy: admin.memberId, split: { mode: "equal", members } });
    const [listed] = await listExpenses(as(ravi, NOW), circle.id);
    expect(listed).toMatchObject({ description: "October physiotherapy", amountMinor: 100000, paidBy: { name: "Priya" } });
    expect(listed.shares.map((s) => s.amountMinor).sort()).toEqual([33333, 33333, 33334]);
    expect(listed.shares.find((s) => s.memberId === admin.memberId)?.amountMinor).toBe(33334);

    const { currencies } = await expenseBalances(as(ravi, NOW), circle.id);
    expect(currencies).toHaveLength(1);
    expect(currencies[0].transfers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: ravi.memberId, fromName: "Ravi", to: admin.memberId, toName: "Priya", amountMinor: 33333 }),
        expect.objectContaining({ from: elder.memberId, to: admin.memberId, amountMinor: 33333 }),
      ]),
    );

    // The people sharing the cost hear about it quietly; the person who added it doesn't.
    const notes = await db().select().from(notifications).where(eq(notifications.kind, "expense_added"));
    expect(notes.map((n) => n.userId).sort()).toEqual([elder.id, ravi.id].sort());
    expect(notes.every((n) => n.priority === "low")).toBe(true);
    expect(notes[0].body).toContain("₹333.33");

    const audit = await listAuditEvents(as(admin, NOW), circle.id);
    expect(audit.find((e) => e.action === "expense.added")).toMatchObject({ entityId: expense.id, metadata: { amountMinor: 100000, currency: "INR" } });
  });

  it("takes custom parts that add up, or a cost only the payer carries", async () => {
    const { admin, ravi, circle, as, add } = await family();
    await add(ravi, { description: "Wheelchair", amount: "1200.50", paidBy: ravi.memberId, split: { mode: "custom", shares: [{ memberId: admin.memberId, amount: "800.50" }, { memberId: ravi.memberId, amount: 400 }] } });
    await add(admin, { description: "Flowers", amount: "300", paidBy: admin.memberId, split: { mode: "payer_only" } });
    const { currencies } = await expenseBalances(as(admin, NOW), circle.id);
    expect(currencies[0].transfers).toEqual([expect.objectContaining({ from: admin.memberId, to: ravi.memberId, amountMinor: 80050 })]);
  });

  it("refuses amounts, dates, people and splits that don't add up", async () => {
    const { admin, caregiver, add, members } = await family();
    const base = { description: "X", paidBy: admin.memberId, split: { mode: "equal", members } };
    await expect(add(admin, { ...base, amount: "12.345" })).rejects.toMatchObject({ code: "validation_failed", details: { amount: expect.any(Array) } });
    await expect(add(admin, { ...base, amount: "100", spentOn: "2026-11-15" })).rejects.toMatchObject({ details: { spentOn: ["That date hasn't happened yet."] } });
    await expect(add(admin, { ...base, amount: "100", spentOn: "2023-01-01" })).rejects.toMatchObject({ details: { spentOn: expect.any(Array) } });
    // A caregiver isn't part of shared costs (they may be the one being paid).
    await expect(add(admin, { ...base, amount: "100", paidBy: caregiver.memberId })).rejects.toMatchObject({ details: { paidBy: expect.any(Array) } });
    await expect(add(admin, { ...base, amount: "100", split: { mode: "equal", members: [caregiver.memberId] } })).rejects.toMatchObject({ details: { split: expect.any(Array) } });
    await expect(add(admin, { ...base, amount: "100", split: { mode: "custom", shares: [{ memberId: admin.memberId, amount: "60" }] } })).rejects.toMatchObject({ details: { split: ["The parts must add up to the total."] } });
  });

  it("a recorded payment settles the balance and tells the other person", async () => {
    const { admin, ravi, circle, as, add } = await family();
    await add(admin, { description: "Taxi to hospital", amount: "700", paidBy: admin.memberId, split: { mode: "custom", shares: [{ memberId: ravi.memberId, amount: "700" }] } });
    const payment = await recordSettlement(as(ravi, NOW), circle.id, { fromMember: ravi.memberId, toMember: admin.memberId, amount: "700", currency: "INR", paidOn: TODAY });
    expect((await expenseBalances(as(admin, NOW), circle.id)).currencies).toEqual([]);
    const [note] = await db().select().from(notifications).where(and(eq(notifications.kind, "settlement_recorded"), eq(notifications.userId, admin.id)));
    expect(note.body).toContain("Ravi paid Priya ₹700.00");

    await expect(recordSettlement(as(ravi, NOW), circle.id, { fromMember: ravi.memberId, toMember: ravi.memberId, amount: "1", currency: "INR", paidOn: TODAY })).rejects.toMatchObject({ code: "validation_failed" });
    // Removing the payment brings the balance back.
    await removeSettlement(as(ravi, NOW), circle.id, payment.id);
    expect((await expenseBalances(as(admin, NOW), circle.id)).currencies[0].transfers).toHaveLength(1);
  });

  it("keeps currencies apart", async () => {
    const { admin, ravi, circle, as, add } = await family();
    await add(ravi, { description: "Flight", amount: "200", currency: "GBP", paidBy: ravi.memberId, split: { mode: "custom", shares: [{ memberId: admin.memberId, amount: "200" }] } });
    await add(admin, { description: "Medicines", amount: "500", paidBy: admin.memberId, split: { mode: "custom", shares: [{ memberId: ravi.memberId, amount: "500" }] } });
    const { currencies } = await expenseBalances(as(admin, NOW), circle.id);
    expect(currencies.map((c) => c.currency).sort()).toEqual(["GBP", "INR"]);
  });

  it("only the person who added it, or someone who manages the circle, can remove it", async () => {
    const { admin, ravi, elder, circle, as, add, members } = await family();
    const mine = await add(ravi, { description: "Groceries", amount: "300", paidBy: ravi.memberId, split: { mode: "equal", members } });
    const theirs = await add(admin, { description: "Doctor", amount: "600", paidBy: admin.memberId, split: { mode: "equal", members } });
    await expect(removeExpense(as(ravi, NOW), circle.id, theirs.id)).rejects.toMatchObject({ code: "forbidden" });
    await removeExpense(as(ravi, NOW), circle.id, mine.id);
    // The parent manages their own circle, so they can tidy up too.
    await removeExpense(as(elder, NOW), circle.id, theirs.id);
    expect(await listExpenses(as(admin, NOW), circle.id)).toEqual([]);
    expect((await expenseBalances(as(admin, NOW), circle.id)).currencies).toEqual([]);
    expect((await listAuditEvents(as(admin, NOW), circle.id)).filter((e) => e.action === "expense.removed")).toHaveLength(2);
    await expect(removeExpense(as(admin, NOW), circle.id, mine.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("is for the family and the parent only: caregivers, clinicians and emergency contacts can't see it", async () => {
    const { caregiver, clinician, neighbour, elder, circle, as } = await family();
    for (const who of [caregiver, clinician, neighbour]) {
      await expect(listExpenses(as(who, NOW), circle.id)).rejects.toMatchObject({ code: "forbidden" });
      await expect(expenseBalances(as(who, NOW), circle.id)).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(await listExpenses(as(elder, NOW), circle.id)).toEqual([]);
  });

  it("is 404 for outsiders and 401 when signed out", async () => {
    const { admin, circle, members } = await family();
    const outsider = await signUp();
    const url = `/api/v1/circles/${circle.id}/expenses`;
    expect((await listRoute(apiRequest("GET", url, { cookie: outsider.cookie }), params({ circleId: circle.id }))).status).toBe(404);
    expect((await listRoute(apiRequest("GET", url), params({ circleId: circle.id }))).status).toBe(401);
    const body = { description: "Taxi", amount: "250", currency: "INR", spentOn: "2026-10-01", paidBy: admin.memberId, split: { mode: "equal", members } };
    expect((await createRoute(apiRequest("POST", url, { body, cookie: outsider.cookie }), params({ circleId: circle.id }))).status).toBe(404);
    expect((await createRoute(apiRequest("POST", url, { body, cookie: admin.cookie }), params({ circleId: circle.id }))).status).toBe(201);
  });

  it("never mixes two families' costs or people", async () => {
    const one = await family();
    const two = await family();
    await two.add(two.admin, { description: "Zebra cost", amount: "999", paidBy: two.admin.memberId, split: { mode: "equal", members: two.members } });
    // People from another circle can't be used here, and another circle's expense can't be removed through this one.
    await expect(one.add(one.admin, { description: "X", amount: "100", paidBy: two.admin.memberId, split: { mode: "payer_only" } })).rejects.toMatchObject({ code: "validation_failed" });
    const [theirs] = await listExpenses(two.as(two.admin, NOW), two.circle.id);
    await expect(removeExpense(one.as(one.admin, NOW), one.circle.id, theirs.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(listExpenses(one.as(one.admin, NOW), two.circle.id)).rejects.toMatchObject({ code: "not_found" });
    expect(await listExpenses(one.as(one.admin, NOW), one.circle.id)).toEqual([]);
    expect((await expenseBalances(one.as(one.admin, NOW), one.circle.id)).currencies).toEqual([]);
  });

  it("keeps the history when someone deletes their account; they show as a former member", async () => {
    const { admin, ravi, circle, as, add } = await family();
    await add(admin, { description: "Physio", amount: "1000", paidBy: admin.memberId, split: { mode: "custom", shares: [{ memberId: ravi.memberId, amount: "1000" }] } });
    await db().delete(users).where(eq(users.id, ravi.id));
    const [listed] = await listExpenses(as(admin, NOW), circle.id);
    expect(listed.shares).toEqual([{ memberId: null, name: null, amountMinor: 100000 }]);
    const [inr] = (await expenseBalances(as(admin, NOW), circle.id)).currencies;
    expect(inr.people).toEqual([expect.objectContaining({ name: "Priya", amountMinor: 100000 }), expect.objectContaining({ memberId: null, amountMinor: -100000 })]);
    // Nobody is asked to collect from someone who has left.
    expect(inr.transfers).toEqual([]);
  });

  it("downloads as CSV and is part of the circle's data export", async () => {
    const { admin, circle, as, add, members } = await family();
    await add(admin, { description: "=cmd|' /C calc'!A0", amount: "90", paidBy: admin.memberId, split: { mode: "equal", members } });
    const csv = await expensesCsv(as(admin, NOW), circle.id);
    const [header, row] = csv.split("\r\n");
    expect(header).toBe("date,type,description,category,amount,currency,paid_by,paid_to,split,shares,note");
    expect(row).toMatch(/^2026-11-14,expense,'=cmd\|' \/C calc'!A0,medicine,90\.00,INR,Priya,,equal,/);
    const res = await exportRoute(apiRequest("GET", `/api/v1/circles/${circle.id}/expenses/export`, { cookie: admin.cookie }), params({ circleId: circle.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const exported = await exportCircle(as(admin, NOW), circle.id);
    expect(exported.expenses).toHaveLength(1);
    expect(exported.expensePayments).toEqual([]);
  });
});
