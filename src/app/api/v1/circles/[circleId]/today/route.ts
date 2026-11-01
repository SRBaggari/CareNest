import { authedRoute } from "@/server/api";
import { getCircleToday } from "@/server/services/today";

/** Dashboard summary for one circle, filtered by what the viewer may see. */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/today">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    return Response.json(await getCircleToday({ db, now, userId: session.user.id }, circleId));
  });
}
