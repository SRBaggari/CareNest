import { authedRoute } from "@/server/api";
import { acceptInvitation } from "@/server/services/invitations";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/invitations/[token]/accept">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { token } = await ctx.params;
    const result = await acceptInvitation({ db, now, userId: session.user.id, userEmail: session.user.email }, token);
    return Response.json(result);
  });
}
