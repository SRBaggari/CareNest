import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { listPushDevices, pushSubscriptionSchema, removePushDeviceByEndpoint, savePushDevice } from "@/server/services/push-devices";

export async function GET(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => Response.json({ devices: await listPushDevices({ db, now, userId: session.user.id }) }));
}

/** Turns on phone alerts for this browser: the body is the browser's PushSubscription (toJSON) plus a label. */
export async function POST(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => {
    const input = await parseBody(request, pushSubscriptionSchema);
    return Response.json({ device: await savePushDevice({ db, now, userId: session.user.id }, input) }, { status: 201 });
  });
}

/** ?endpoint=… turns alerts off for that browser, if it's one of the signed-in person's devices. */
export async function DELETE(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => {
    const endpoint = new URL(request.url).searchParams.get("endpoint") ?? "";
    await removePushDeviceByEndpoint({ db, now, userId: session.user.id }, endpoint);
    return new Response(null, { status: 204 });
  });
}
