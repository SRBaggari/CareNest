import { z } from "zod";
import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { claimTask } from "@/server/services/tasks";

const schema = z.object({ action: z.enum(["claim", "release"]) });

/** "I'll do it" ({action:"claim"}) or "I can't do it after all" ({action:"release"}). */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/tasks/[taskId]/claim">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, taskId } = await ctx.params;
    const { action } = await parseBody(request, schema);
    return Response.json({ task: await claimTask({ db, now, userId: session.user.id }, circleId, taskId, action) });
  });
}
