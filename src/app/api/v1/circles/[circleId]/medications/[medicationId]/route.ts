import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { getMedication, updateMedication, updateMedicationSchema } from "@/server/services/medications";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/medications/[medicationId]">;

export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, medicationId } = await ctx.params;
    return Response.json({ medication: await getMedication({ db, now, userId: session.user.id }, circleId, medicationId) });
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, medicationId } = await ctx.params;
    const input = await parseBody(request, updateMedicationSchema);
    const medication = await updateMedication({ db, now, userId: session.user.id }, circleId, medicationId, input);
    return Response.json({ medication });
  });
}
