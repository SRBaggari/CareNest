import { authedRoute } from "@/server/api";
import { expensesCsv } from "@/server/services/expenses";

/** Every expense and payment as a CSV download. */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/expenses/export">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const csv = await expensesCsv({ db, now, userId: session.user.id }, (await ctx.params).circleId);
    // The byte-order mark makes Excel read the file as UTF-8, so Indian scripts show correctly.
    return new Response(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="carenest-expenses-${now.toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
