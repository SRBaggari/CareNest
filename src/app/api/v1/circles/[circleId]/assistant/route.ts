import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { askAssistant, askSchema, assistantStatus } from "@/server/services/assistant";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/assistant">;

/** Whether the assistant is set up on this server and turned on for this circle. */
export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => Response.json(await assistantStatus({ db, now, userId: session.user.id }, (await ctx.params).circleId)));
}

/** { question } → an answer from the circle's records, with the records it used. Nothing is stored. */
export async function POST(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const input = await parseBody(request, askSchema);
    const answer = await askAssistant({ db, now, userId: session.user.id }, (await ctx.params).circleId, input, session.user.locale);
    return Response.json(answer, { headers: { "Cache-Control": "no-store" } });
  });
}
