import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { getMySms, removePhone, setPhoneSchema, smsSettingsSchema, startPhoneVerification, updateSmsSettings } from "@/server/services/sms";

/** My number for text messages (masked), whether it's verified, and which alerts are texted. */
export async function GET(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => Response.json(await getMySms({ db, now, userId: session.user.id })));
}

/** Save a number ({ phone }) and text a code to it. */
export async function PUT(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => {
    const input = await parseBody(request, setPhoneSchema);
    return Response.json(await startPhoneVerification({ db, now, userId: session.user.id }, input));
  });
}

/** { urgentOnly: true } texts only requests for help; false texts every alert above low priority. */
export async function PATCH(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => {
    const input = await parseBody(request, smsSettingsSchema);
    return Response.json(await updateSmsSettings({ db, now, userId: session.user.id }, input));
  });
}

/** Stop text messages and forget the number. */
export async function DELETE(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => {
    await removePhone({ db, now, userId: session.user.id });
    return new Response(null, { status: 204 });
  });
}
