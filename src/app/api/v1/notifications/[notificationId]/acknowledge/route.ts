import { authedRoute } from "@/server/api";
import { acknowledge } from "@/server/services/notifications";

/** "I'm checking on it" — shown to everyone else alerted about the same event. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/notifications/[notificationId]/acknowledge">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { notificationId } = await ctx.params;
    await acknowledge({ db, now, userId: session.user.id }, notificationId);
    return new Response(null, { status: 204 });
  });
}
