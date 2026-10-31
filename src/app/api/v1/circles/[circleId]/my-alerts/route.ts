import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { alertSettingsSchema, getMyAlertSettings, updateMyAlertSettings } from "@/server/services/notifications";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/my-alerts">;

/** The signed-in member's own alert choices for this circle. */
export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    return Response.json(await getMyAlertSettings({ db, now, userId: session.user.id }, circleId));
  });
}

export async function PUT(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const input = await parseBody(request, alertSettingsSchema);
    return Response.json(await updateMyAlertSettings({ db, now, userId: session.user.id }, circleId, input));
  });
}
