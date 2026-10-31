import { authedRoute } from "@/server/api";
import { getAssistance } from "@/server/services/assistance";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/emergency/requests/[requestId]">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, requestId } = await ctx.params;
    return Response.json({ request: await getAssistance({ db, now, userId: session.user.id }, circleId, requestId) });
  });
}
