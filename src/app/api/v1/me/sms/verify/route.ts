import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { confirmPhone, verifyPhoneSchema } from "@/server/services/sms";

/** Confirm the number with the code that was texted to it: { code }. */
export async function POST(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => {
    const input = await parseBody(request, verifyPhoneSchema);
    return Response.json(await confirmPhone({ db, now, userId: session.user.id }, input));
  });
}
