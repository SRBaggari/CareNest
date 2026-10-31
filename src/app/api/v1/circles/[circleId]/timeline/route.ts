import { authedRoute } from "@/server/api";
import { getTimeline } from "@/server/services/timeline";

/** ?kinds=dose,appointment,task,visit,update,medication&q=search&before=ISO&limit=40 */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/timeline">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return Response.json(await getTimeline({ db, now, userId: session.user.id }, circleId, query));
  });
}
