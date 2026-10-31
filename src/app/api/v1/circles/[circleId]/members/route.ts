import { authedRoute } from "@/server/api";
import { listMembers } from "@/server/services/members";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/members">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    return Response.json({ members: await listMembers({ db, now, userId: session.user.id }, circleId) });
  });
}
