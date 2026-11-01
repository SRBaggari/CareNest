import { authedRoute } from "@/server/api";
import { removeMeasurement } from "@/server/services/measurements";

/** Removes a reading entered by mistake (by whoever recorded it, or an admin). */
export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/measurements/[measurementId]">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, measurementId } = await ctx.params;
    await removeMeasurement({ db, now, userId: session.user.id }, circleId, measurementId);
    return new Response(null, { status: 204 });
  });
}
