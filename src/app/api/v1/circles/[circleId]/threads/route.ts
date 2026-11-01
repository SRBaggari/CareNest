import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { listThreads, startThread, startThreadSchema } from "@/server/services/messages";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/threads">;

export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) =>
    Response.json({ threads: await listThreads({ db, now, userId: session.user.id }, (await ctx.params).circleId) }),
  );
}

/** Start a conversation: { title, body, notify: [membershipId…] }. */
export async function POST(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const input = await parseBody(request, startThreadSchema);
    return Response.json({ thread: await startThread({ db, now, userId: session.user.id }, (await ctx.params).circleId, input) }, { status: 201 });
  });
}
