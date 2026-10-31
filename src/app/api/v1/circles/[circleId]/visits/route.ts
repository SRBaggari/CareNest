import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { createVisit, createVisitSchema, latestHandover, listVisits } from "@/server/services/visits";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/visits">;

/** ?range=upcoming (default) | recent — plus the latest handover note for whoever comes next. */
export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const range = new URL(request.url).searchParams.get("range") === "recent" ? "recent" : "upcoming";
    const c = { db, now, userId: session.user.id };
    return Response.json({ visits: await listVisits(c, circleId, range), latestHandover: await latestHandover(c, circleId) });
  });
}

export async function POST(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const input = await parseBody(request, createVisitSchema);
    return Response.json({ visit: await createVisit({ db, now, userId: session.user.id }, circleId, input) }, { status: 201 });
  });
}
