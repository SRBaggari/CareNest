import { authedRoute } from "@/server/api";
import { markRead } from "@/server/services/notifications";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/notifications/[notificationId]/read">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { notificationId } = await ctx.params;
    await markRead({ db, now, userId: session.user.id }, notificationId);
    return new Response(null, { status: 204 });
  });
}
