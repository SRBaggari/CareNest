import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { getThread, postMessage, postMessageSchema } from "@/server/services/messages";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/threads/[threadId]">;

/** The conversation's messages; opening it marks it read for this person. */
export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, threadId } = await ctx.params;
    return Response.json({ thread: await getThread({ db, now, userId: session.user.id }, circleId, threadId) });
  });
}

/** Reply: { body, notify: [membershipId…] }. */
export async function POST(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, threadId } = await ctx.params;
    const input = await parseBody(request, postMessageSchema);
    return Response.json({ message: await postMessage({ db, now, userId: session.user.id }, circleId, threadId, input) }, { status: 201 });
  });
}
