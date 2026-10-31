import { publicRoute } from "@/server/api";
import { getClientIp, sessionCookie } from "@/server/auth/request";
import { createSession } from "@/server/auth/session";
import { parseBody } from "@/server/http";
import { loginSchema, loginUser } from "@/server/services/accounts";

export async function POST(request: Request) {
  return publicRoute(request, async ({ db, now }) => {
    const input = await parseBody(request, loginSchema);
    const user = await loginUser(db, input, { ip: getClientIp(request), now });
    const session = await createSession(db, { userId: user.id, now, userAgent: request.headers.get("user-agent") });
    return Response.json({ user }, { headers: { "Set-Cookie": sessionCookie(session.token, session.expiresAt) } });
  });
}
