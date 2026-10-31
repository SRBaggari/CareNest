import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { emergencyInfoSchema, getEmergencyInfo, updateEmergencyInfo } from "@/server/services/emergency";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/emergency/info">;

export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    return Response.json(await getEmergencyInfo({ db, now, userId: session.user.id }, circleId));
  });
}

export async function PUT(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const input = await parseBody(request, emergencyInfoSchema);
    return Response.json(await updateEmergencyInfo({ db, now, userId: session.user.id }, circleId, input));
  });
}
