import { authedRoute } from "@/server/api";
import { revokeUserSession } from "@/server/auth/session";
import { AppError } from "@/server/http";
import { uuidSchema } from "@/server/validation";

/** Signs out one device (e.g. a lost phone or a parent's shared tablet). */
export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/me/sessions/[sessionId]">) {
  return authedRoute(request, async ({ db, session }) => {
    const { sessionId } = await ctx.params;
    const parsed = uuidSchema.safeParse(sessionId);
    if (!parsed.success || !(await revokeUserSession(db, session.user.id, parsed.data))) {
      throw new AppError("not_found", "Session not found.");
    }
    return new Response(null, { status: 204 });
  });
}
