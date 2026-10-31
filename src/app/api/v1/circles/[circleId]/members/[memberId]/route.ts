import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { removeMember, updateMember, updateMemberSchema } from "@/server/services/members";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/members/[memberId]">;

export async function PATCH(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, memberId } = await ctx.params;
    const input = await parseBody(request, updateMemberSchema);
    return Response.json({ members: await updateMember({ db, now, userId: session.user.id }, circleId, memberId, input) });
  });
}

/** Removes a member, or lets a member leave when it is their own membership. */
export async function DELETE(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, memberId } = await ctx.params;
    await removeMember({ db, now, userId: session.user.id }, circleId, memberId);
    return new Response(null, { status: 204 });
  });
}
