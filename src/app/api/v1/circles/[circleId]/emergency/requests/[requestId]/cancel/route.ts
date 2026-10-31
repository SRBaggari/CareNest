import { authedRoute } from "@/server/api";
import { cancelAssistance } from "@/server/services/assistance";

/** False alarm. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/emergency/requests/[requestId]/cancel">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, requestId } = await ctx.params;
    return Response.json({ request: await cancelAssistance({ db, now, userId: session.user.id }, circleId, requestId) });
  });
}
