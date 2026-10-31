import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { recordAsNeededDose, recordAsNeededSchema } from "@/server/services/doses";

/** Records an as-needed dose of a medicine that has no fixed schedule. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/medications/[medicationId]/doses">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, medicationId } = await ctx.params;
    const input = await parseBody(request, recordAsNeededSchema);
    const dose = await recordAsNeededDose({ db, now, userId: session.user.id }, circleId, medicationId, input);
    return Response.json({ dose }, { status: 201 });
  });
}
