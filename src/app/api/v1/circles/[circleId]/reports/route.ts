import { authedRoute } from "@/server/api";
import { doctorSummary, reportQuerySchema } from "@/server/services/reports";

/** The "for the doctor" summary. ?from=YYYY-MM-DD&to=YYYY-MM-DD (the parent's local dates; default: last 30 days). */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/reports">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const query = reportQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const report = await doctorSummary({ db, now, userId: session.user.id }, (await ctx.params).circleId, query);
    return Response.json({ report }, { headers: { "Cache-Control": "no-store" } });
  });
}
