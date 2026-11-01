import { authedRoute } from "@/server/api";
import { removePushDevice } from "@/server/services/push-devices";

export async function DELETE(request: Request, { params }: RouteContext<"/api/v1/me/push-devices/[deviceId]">) {
  return authedRoute(request, async ({ db, now, session }) => {
    await removePushDevice({ db, now, userId: session.user.id }, (await params).deviceId);
    return new Response(null, { status: 204 });
  });
}
