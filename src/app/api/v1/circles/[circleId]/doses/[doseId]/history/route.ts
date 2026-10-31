import { authedRoute } from "@/server/api";
import { getDoseHistory } from "@/server/services/doses";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/doses/[doseId]/history">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, doseId } = await ctx.params;
    return Response.json({ history: await getDoseHistory({ db, now, userId: session.user.id }, circleId, doseId) });
  });
}
