import { publicRoute } from "@/server/api";
import { clearSessionCookie, getSessionToken } from "@/server/auth/request";
import { invalidateSessionToken } from "@/server/auth/session";

/** Always succeeds and clears the cookie, even if the session had already expired. */
export async function POST(request: Request) {
  return publicRoute(request, async ({ db }) => {
    const token = getSessionToken(request);
    if (token) await invalidateSessionToken(db, token);
    return new Response(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie() } });
  });
}
