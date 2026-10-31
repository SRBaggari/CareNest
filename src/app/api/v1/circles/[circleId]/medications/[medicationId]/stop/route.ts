import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { stopMedication, stopMedicationSchema } from "@/server/services/medications";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/medications/[medicationId]/stop">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, medicationId } = await ctx.params;
    const input = await parseBody(request, stopMedicationSchema);
    const medication = await stopMedication({ db, now, userId: session.user.id }, circleId, medicationId, input);
    return Response.json({ medication });
  });
}
