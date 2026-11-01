import { authedRoute } from "@/server/api";
import { removeSettlement } from "@/server/services/expenses";

export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/settlements/[settlementId]">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, settlementId } = await ctx.params;
    await removeSettlement({ db, now, userId: session.user.id }, circleId, settlementId);
    return new Response(null, { status: 204 });
  });
}
