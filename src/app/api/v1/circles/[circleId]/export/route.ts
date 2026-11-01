import { authedRoute } from "@/server/api";
import { exportCircle } from "@/server/services/data-rights";

/** Download the circle's complete record (people who manage the circle only). */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/export">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const data = await exportCircle({ db, now, userId: session.user.id }, circleId);
    return Response.json(data, {
      headers: { "Content-Disposition": `attachment; filename="carenest-circle-${now.toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" },
    });
  });
}
