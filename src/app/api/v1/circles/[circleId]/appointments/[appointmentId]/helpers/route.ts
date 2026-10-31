import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { assignHelper, assignHelperSchema } from "@/server/services/appointments";

/** Set who drives or accompanies: { role: "transport" | "companion", memberId | null }. */
export async function PUT(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/appointments/[appointmentId]/helpers">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, appointmentId } = await ctx.params;
    const input = await parseBody(request, assignHelperSchema);
    return Response.json({ appointment: await assignHelper({ db, now, userId: session.user.id }, circleId, appointmentId, input) });
  });
}
