import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { cancelAppointment, cancelAppointmentSchema } from "@/server/services/appointments";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/appointments/[appointmentId]/cancel">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, appointmentId } = await ctx.params;
    const input = await parseBody(request, cancelAppointmentSchema);
    return Response.json({ appointment: await cancelAppointment({ db, now, userId: session.user.id }, circleId, appointmentId, input) });
  });
}
