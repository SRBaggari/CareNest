import { authedRoute } from "@/server/api";
import { measurementsCsv, reportQuerySchema } from "@/server/services/reports";

/** Readings as a CSV download. ?from=YYYY-MM-DD&to=YYYY-MM-DD, as for the summary. */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/reports/measurements">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const query = reportQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const { csv, period } = await measurementsCsv({ db, now, userId: session.user.id }, (await ctx.params).circleId, query);
    // The byte-order mark makes Excel read the file as UTF-8, so Indian scripts in notes show correctly.
    return new Response(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="carenest-readings-${period.from}-to-${period.to}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
