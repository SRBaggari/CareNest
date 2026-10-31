import { publicRoute } from "@/server/api";
import { getClientIp, sessionCookie } from "@/server/auth/request";
import { createSession } from "@/server/auth/session";
import { parseBody } from "@/server/http";
import { registerSchema, registerUser } from "@/server/services/accounts";

export async function POST(request: Request) {
  return publicRoute(request, async ({ db, now }) => {
    const input = await parseBody(request, registerSchema);
    const user = await registerUser(db, input, { ip: getClientIp(request), now });
    const session = await createSession(db, { userId: user.id, now, userAgent: request.headers.get("user-agent") });
    return Response.json(
      { user },
      { status: 201, headers: { "Set-Cookie": sessionCookie(session.token, session.expiresAt) } },
    );
  });
}
