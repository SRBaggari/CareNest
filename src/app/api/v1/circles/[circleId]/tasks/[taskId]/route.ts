import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { getTask, updateTask, updateTaskSchema } from "@/server/services/tasks";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/tasks/[taskId]">;

export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, taskId } = await ctx.params;
    return Response.json({ task: await getTask({ db, now, userId: session.user.id }, circleId, taskId) });
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, taskId } = await ctx.params;
    const input = await parseBody(request, updateTaskSchema);
    return Response.json({ task: await updateTask({ db, now, userId: session.user.id }, circleId, taskId, input) });
  });
}
