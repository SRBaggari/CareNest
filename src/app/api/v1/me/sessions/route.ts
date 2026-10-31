import { authedRoute } from "@/server/api";
import { listUserSessions } from "@/server/auth/session";

export async function GET(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => {
    const rows = await listUserSessions(db, session.user.id, now);
    return Response.json({
      sessions: rows.map((s) => ({ ...s, current: s.id === session.sessionId })),
    });
  });
}
