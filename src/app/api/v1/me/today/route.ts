import { authedRoute } from "@/server/api";
import { getMyToday } from "@/server/services/today";

/** What needs attention across all of the signed-in user's circles. */
export async function GET(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => Response.json(await getMyToday({ db, now, userId: session.user.id })));
}
