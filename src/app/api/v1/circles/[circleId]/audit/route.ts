import { authedRoute } from "@/server/api";
import { AppError } from "@/server/http";
import { listAuditEvents } from "@/server/services/audit";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/audit">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const beforeParam = new URL(request.url).searchParams.get("before");
    const before = beforeParam ? new Date(beforeParam) : undefined;
    if (before && Number.isNaN(before.getTime())) throw new AppError("bad_request", "Invalid 'before' cursor.");
    return Response.json({ events: await listAuditEvents({ db, now, userId: session.user.id }, circleId, { before }) });
  });
}
