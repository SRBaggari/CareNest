import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { getCircle, updateCircle, updateCircleSchema } from "@/server/services/circles";

type Ctx = RouteContext<"/api/v1/circles/[circleId]">;

export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    return Response.json({ circle: await getCircle({ db, now, userId: session.user.id }, circleId) });
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const input = await parseBody(request, updateCircleSchema);
    return Response.json({ circle: await updateCircle({ db, now, userId: session.user.id }, circleId, input) });
  });
}
