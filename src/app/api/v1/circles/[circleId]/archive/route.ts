import { authedRoute } from "@/server/api";
import { archiveCircle } from "@/server/services/circles";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/archive">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    return Response.json({ circle: await archiveCircle({ db, now, userId: session.user.id }, circleId) });
  });
}
