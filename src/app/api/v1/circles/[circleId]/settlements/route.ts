import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { listSettlements, recordSettlement, recordSettlementSchema } from "@/server/services/expenses";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/settlements">;

export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    return Response.json({ settlements: await listSettlements({ db, now, userId: session.user.id }, (await ctx.params).circleId) });
  });
}

/** Records that one person paid another back: { fromMember, toMember, amount, currency, paidOn, note? } */
export async function POST(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const input = await parseBody(request, recordSettlementSchema);
    return Response.json({ settlement: await recordSettlement({ db, now, userId: session.user.id }, (await ctx.params).circleId, input) }, { status: 201 });
  });
}
