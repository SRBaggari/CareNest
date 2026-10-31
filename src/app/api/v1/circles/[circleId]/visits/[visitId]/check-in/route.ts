import { authedRoute } from "@/server/api";
import { checkIn } from "@/server/services/visits";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/visits/[visitId]/check-in">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, visitId } = await ctx.params;
    return Response.json({ visit: await checkIn({ db, now, userId: session.user.id }, circleId, visitId) });
  });
}
