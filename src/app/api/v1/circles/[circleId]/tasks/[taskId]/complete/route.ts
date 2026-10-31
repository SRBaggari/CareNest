import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { completeTask, completeTaskSchema } from "@/server/services/tasks";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/tasks/[taskId]/complete">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, taskId } = await ctx.params;
    const input = await parseBody(request, completeTaskSchema);
    return Response.json(await completeTask({ db, now, userId: session.user.id }, circleId, taskId, input));
  });
}
