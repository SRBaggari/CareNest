import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { cancelVisit, cancelVisitSchema } from "@/server/services/visits";

/** "I can't make it" (the visitor) or a cancellation by an organiser. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/visits/[visitId]/cancel">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, visitId } = await ctx.params;
    const input = await parseBody(request, cancelVisitSchema);
    return Response.json({ visit: await cancelVisit({ db, now, userId: session.user.id }, circleId, visitId, input) });
  });
}
