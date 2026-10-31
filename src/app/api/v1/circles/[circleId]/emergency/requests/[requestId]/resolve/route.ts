import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { resolveAssistance, resolveSchema } from "@/server/services/assistance";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/emergency/requests/[requestId]/resolve">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, requestId } = await ctx.params;
    const input = await parseBody(request, resolveSchema);
    return Response.json({ request: await resolveAssistance({ db, now, userId: session.user.id }, circleId, requestId, input) });
  });
}
