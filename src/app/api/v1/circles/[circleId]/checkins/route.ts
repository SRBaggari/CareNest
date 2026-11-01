import { authedRoute } from "@/server/api";
import { listCheckins } from "@/server/services/measurements";

/** The parent's "How are you today?" answers for the last 14 days, one per day. */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/checkins">) {
  return authedRoute(request, async ({ db, now, session }) =>
    Response.json({ checkins: await listCheckins({ db, now, userId: session.user.id }, (await ctx.params).circleId) }),
  );
}
