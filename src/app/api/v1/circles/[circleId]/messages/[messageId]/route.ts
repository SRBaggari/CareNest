import { authedRoute } from "@/server/api";
import { removeMessage } from "@/server/services/messages";

/** Authors take back their own message (it shows as "Message removed"). */
export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/messages/[messageId]">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, messageId } = await ctx.params;
    await removeMessage({ db, now, userId: session.user.id }, circleId, messageId);
    return new Response(null, { status: 204 });
  });
}
