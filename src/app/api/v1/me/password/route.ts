import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { changePassword, changePasswordSchema } from "@/server/services/accounts";

export async function POST(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => {
    const input = await parseBody(request, changePasswordSchema);
    await changePassword(db, { ...input, userId: session.user.id, currentSessionId: session.sessionId, now });
    return new Response(null, { status: 204 });
  });
}
