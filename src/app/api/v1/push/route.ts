import { authedRoute } from "@/server/api";
import { pushConfig } from "@/server/services/push-devices";

/** Whether phone alerts are available on this server, and the public key browsers subscribe with. */
export async function GET(request: Request) {
  return authedRoute(request, async () => Response.json(pushConfig()));
}
