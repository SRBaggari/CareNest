import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { createExpense, createExpenseSchema, listExpenses } from "@/server/services/expenses";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/expenses">;

export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    return Response.json({ expenses: await listExpenses({ db, now, userId: session.user.id }, (await ctx.params).circleId) });
  });
}

/** { description, category, amount: "1200.50", currency, spentOn, paidBy, split: { mode: "equal", members } | { mode: "custom", shares } | { mode: "payer_only" }, note? } */
export async function POST(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const input = await parseBody(request, createExpenseSchema);
    return Response.json({ expense: await createExpense({ db, now, userId: session.user.id }, (await ctx.params).circleId, input) }, { status: 201 });
  });
}
