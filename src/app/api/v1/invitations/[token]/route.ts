import { publicRoute } from "@/server/api";
import { previewInvitation } from "@/server/services/invitations";

/** Invitation preview for the invite page; works signed out so the invitee knows what they are joining. */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/invitations/[token]">) {
  return publicRoute(request, async ({ db, now }) => {
    const { token } = await ctx.params;
    return Response.json({ invitation: await previewInvitation(db, token, now) });
  });
}
