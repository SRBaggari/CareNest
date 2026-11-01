import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { clearSessionCookie } from "@/server/auth/request";
import { updateProfile, updateProfileSchema } from "@/server/services/accounts";
import { deleteAccountSchema, deleteMyAccount } from "@/server/services/data-rights";

export async function GET(request: Request) {
  return authedRoute(request, async ({ session }) => Response.json({ user: session.user }));
}

export async function PATCH(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => {
    const input = await parseBody(request, updateProfileSchema);
    const user = await updateProfile(db, session.user.id, input, now);
    return Response.json({ user });
  });
}

/** Deletes the account (password + typing DELETE). Care records stay, with authorship removed. */
export async function DELETE(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => {
    const input = await parseBody(request, deleteAccountSchema);
    await deleteMyAccount({ db, now, userId: session.user.id }, input);
    return new Response(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie() } });
  });
}
