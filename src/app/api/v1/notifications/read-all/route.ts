import { authedRoute } from "@/server/api";
import { markAllRead } from "@/server/services/notifications";

export async function POST(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => {
    await markAllRead({ db, now, userId: session.user.id });
    return new Response(null, { status: 204 });
  });
}
