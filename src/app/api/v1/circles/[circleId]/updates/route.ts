import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { listUpdates, listUpdatesQuerySchema, postUpdate, postUpdateSchema } from "@/server/services/updates";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/updates">;

export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const query = listUpdatesQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json({ updates: await listUpdates({ db, now, userId: session.user.id }, circleId, query) });
  });
}

export async function POST(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const input = await parseBody(request, postUpdateSchema);
    return Response.json({ update: await postUpdate({ db, now, userId: session.user.id }, circleId, input) }, { status: 201 });
  });
}
