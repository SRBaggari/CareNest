import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { createTask, createTaskSchema, listTasks, listTasksQuerySchema } from "@/server/services/tasks";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/tasks">;

/** ?status=open|done|all&assignee=me|unassigned|any */
export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const query = listTasksQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json({ tasks: await listTasks({ db, now, userId: session.user.id }, circleId, query) });
  });
}

export async function POST(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const input = await parseBody(request, createTaskSchema);
    return Response.json({ task: await createTask({ db, now, userId: session.user.id }, circleId, input) }, { status: 201 });
  });
}
