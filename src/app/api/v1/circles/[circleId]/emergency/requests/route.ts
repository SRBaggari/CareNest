import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { deliverPushAfterResponse } from "@/server/notifications/push";
import { deliverSmsAfterResponse } from "@/server/notifications/sms";
import { listAssistance, raiseAssistance, raiseAssistanceSchema } from "@/server/services/assistance";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/emergency/requests">;

export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    return Response.json({ requests: await listAssistance({ db, now, userId: session.user.id }, circleId) });
  });
}

/** "I need help". Returns 200 with alreadyOpen=true if a request is already in progress. */
export async function POST(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const input = await parseBody(request, raiseAssistanceSchema);
    const result = await raiseAssistance({ db, now, userId: session.user.id }, circleId, input);
    // Phones should buzz now, not on the worker's next tick.
    if (!result.alreadyOpen) {
      await deliverPushAfterResponse(db, now);
      await deliverSmsAfterResponse(db, now);
    }
    return Response.json({ request: result }, { status: result.alreadyOpen ? 200 : 201 });
  });
}
