import { authedRoute } from "@/server/api";
import { sendTestPush } from "@/server/services/push-devices";

export async function POST(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => Response.json({ result: await sendTestPush({ db, now, userId: session.user.id }) }));
}
