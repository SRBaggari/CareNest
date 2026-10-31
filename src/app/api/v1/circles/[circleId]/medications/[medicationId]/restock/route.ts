import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { restockMedication, restockSchema } from "@/server/services/medications";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/medications/[medicationId]/restock">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, medicationId } = await ctx.params;
    const input = await parseBody(request, restockSchema);
    const medication = await restockMedication({ db, now, userId: session.user.id }, circleId, medicationId, input);
    return Response.json({ medication });
  });
}
