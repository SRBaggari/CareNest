import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { getAppointment, updateAppointment, updateAppointmentSchema } from "@/server/services/appointments";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/appointments/[appointmentId]">;

export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, appointmentId } = await ctx.params;
    return Response.json({ appointment: await getAppointment({ db, now, userId: session.user.id }, circleId, appointmentId) });
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, appointmentId } = await ctx.params;
    const input = await parseBody(request, updateAppointmentSchema);
    return Response.json({ appointment: await updateAppointment({ db, now, userId: session.user.id }, circleId, appointmentId, input) });
  });
}
