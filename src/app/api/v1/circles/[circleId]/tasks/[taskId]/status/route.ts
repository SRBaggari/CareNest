import { z } from "zod";
import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { setTaskStatus } from "@/server/services/tasks";

const schema = z.object({ action: z.enum(["reopen", "cancel"]) });

export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/tasks/[taskId]/status">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, taskId } = await ctx.params;
    const { action } = await parseBody(request, schema);
    return Response.json({ task: await setTaskStatus({ db, now, userId: session.user.id }, circleId, taskId, action) });
  });
}
