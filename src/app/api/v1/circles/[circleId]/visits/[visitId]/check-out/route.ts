import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { checkOut, checkOutSchema } from "@/server/services/visits";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/visits/[visitId]/check-out">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, visitId } = await ctx.params;
    const input = await parseBody(request, checkOutSchema);
    return Response.json({ visit: await checkOut({ db, now, userId: session.user.id }, circleId, visitId, input) });
  });
}
