import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { consentSchema, updateConsent } from "@/server/services/circles";

export async function PUT(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/consent">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const input = await parseBody(request, consentSchema);
    return Response.json({ circle: await updateConsent({ db, now, userId: session.user.id }, circleId, input) });
  });
}
