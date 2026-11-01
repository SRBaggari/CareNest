import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { subjectSchema, threadForSubject } from "@/server/services/messages";

/** The conversation about an appointment or task ({ subjectType, subjectId }), started on first use. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/threads/for-subject">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const input = await parseBody(request, subjectSchema);
    return Response.json({ thread: await threadForSubject({ db, now, userId: session.user.id }, (await ctx.params).circleId, input) });
  });
}
