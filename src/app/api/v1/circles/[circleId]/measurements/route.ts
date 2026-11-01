import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { listMeasurements, listMeasurementsQuerySchema, recordMeasurement, recordMeasurementSchema } from "@/server/services/measurements";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/measurements">;

/** ?kind=blood_pressure&days=90 */
export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const query = listMeasurementsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json({ measurements: await listMeasurements({ db, now, userId: session.user.id }, (await ctx.params).circleId, query) });
  });
}

export async function POST(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const input = await parseBody(request, recordMeasurementSchema);
    return Response.json({ measurement: await recordMeasurement({ db, now, userId: session.user.id }, (await ctx.params).circleId, input) }, { status: 201 });
  });
}
