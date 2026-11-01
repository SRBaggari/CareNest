import { authedRoute } from "@/server/api";
import { removeExpense } from "@/server/services/expenses";

export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/expenses/[expenseId]">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, expenseId } = await ctx.params;
    await removeExpense({ db, now, userId: session.user.id }, circleId, expenseId);
    return new Response(null, { status: 204 });
  });
}
