import { authedRoute } from "@/server/api";
import { acknowledgeAssistance } from "@/server/services/assistance";

/** "I'm responding". */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/emergency/requests/[requestId]/acknowledge">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, requestId } = await ctx.params;
    return Response.json({ request: await acknowledgeAssistance({ db, now, userId: session.user.id }, circleId, requestId) });
  });
}
