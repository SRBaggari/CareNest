import { authedRoute } from "@/server/api";
import { listNotifications, listNotificationsQuerySchema } from "@/server/services/notifications";

export async function GET(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => {
    const search = new URL(request.url).searchParams;
    const query = listNotificationsQuerySchema.parse(Object.fromEntries(search));
    return Response.json(await listNotifications({ db, now, userId: session.user.id }, query));
  });
}
