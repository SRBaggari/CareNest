import { authedRoute } from "@/server/api";
import { listDoses, listDosesQuerySchema } from "@/server/services/doses";

/** Doses for the recipient's local day(s): ?date=YYYY-MM-DD&days=1..7 (defaults to their today). */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/doses">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const search = new URL(request.url).searchParams;
    const query = listDosesQuerySchema.parse({ date: search.get("date") ?? undefined, days: search.get("days") ?? undefined });
    return Response.json(await listDoses({ db, now, userId: session.user.id }, circleId, query));
  });
}
