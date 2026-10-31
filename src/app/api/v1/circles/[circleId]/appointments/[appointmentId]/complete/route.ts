import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { completeAppointment, completeAppointmentSchema } from "@/server/services/appointments";

/** Records what happened at the appointment (a member's summary, not a clinical record). */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/appointments/[appointmentId]/complete">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, appointmentId } = await ctx.params;
    const input = await parseBody(request, completeAppointmentSchema);
    return Response.json({ appointment: await completeAppointment({ db, now, userId: session.user.id }, circleId, appointmentId, input) });
  });
}
