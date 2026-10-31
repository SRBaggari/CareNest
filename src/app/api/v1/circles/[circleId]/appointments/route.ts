import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { createAppointment, createAppointmentSchema, listAppointments } from "@/server/services/appointments";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/appointments">;

/** ?range=upcoming (default) | past */
export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const range = new URL(request.url).searchParams.get("range") === "past" ? "past" : "upcoming";
    return Response.json({ appointments: await listAppointments({ db, now, userId: session.user.id }, circleId, { range }) });
  });
}

export async function POST(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const input = await parseBody(request, createAppointmentSchema);
    const appointment = await createAppointment({ db, now, userId: session.user.id }, circleId, input);
    return Response.json({ appointment }, { status: 201 });
  });
}
