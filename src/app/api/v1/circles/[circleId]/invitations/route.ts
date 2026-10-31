import { authedRoute } from "@/server/api";
import { appOrigin } from "@/server/auth/request";
import { parseBody } from "@/server/http";
import { createInvitation, createInvitationSchema, listPendingInvitations } from "@/server/services/invitations";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/invitations">;

export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    return Response.json({ invitations: await listPendingInvitations({ db, now, userId: session.user.id }, circleId) });
  });
}

export async function POST(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const input = await parseBody(request, createInvitationSchema);
    const result = await createInvitation({ db, now, userId: session.user.id }, circleId, input, appOrigin(request));
    return Response.json(result, { status: 201 });
  });
}
