import { authedRoute } from "@/server/api";
import { revokeInvitation } from "@/server/services/invitations";

export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/invitations/[invitationId]">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, invitationId } = await ctx.params;
    await revokeInvitation({ db, now, userId: session.user.id }, circleId, invitationId);
    return new Response(null, { status: 204 });
  });
}
