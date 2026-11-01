import { authedRoute } from "@/server/api";
import { expenseBalances } from "@/server/services/expenses";

/** Where everyone stands per currency, and the payments that would settle it. */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/expenses/balances">) {
  return authedRoute(request, async ({ db, now, session }) => {
    return Response.json(await expenseBalances({ db, now, userId: session.user.id }, (await ctx.params).circleId));
  });
}
