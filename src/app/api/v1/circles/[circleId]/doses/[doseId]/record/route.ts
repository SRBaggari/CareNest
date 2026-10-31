import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { recordDose, recordDoseSchema } from "@/server/services/doses";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/doses/[doseId]/record">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, doseId } = await ctx.params;
    const input = await parseBody(request, recordDoseSchema);
    return Response.json({ dose: await recordDose({ db, now, userId: session.user.id }, circleId, doseId, input) });
  });
}
