import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { selfManagingSchema, setSelfManaging } from "@/server/services/circles";

export async function PUT(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/self-managing">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const input = await parseBody(request, selfManagingSchema);
    return Response.json({ circle: await setSelfManaging({ db, now, userId: session.user.id }, circleId, input) });
  });
}
