import { authedRoute } from "@/server/api";
import { createCalendarFeed, getCalendarFeed, revokeCalendarFeed } from "@/server/services/calendar";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/calendar-feed">;

/** Whether I have a calendar link for this circle (the link itself is only shown when made). */
export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) =>
    Response.json({ feed: await getCalendarFeed({ db, now, userId: session.user.id }, (await ctx.params).circleId) }),
  );
}

/** Makes my calendar link, replacing any earlier one. */
export async function POST(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) =>
    Response.json({ feed: await createCalendarFeed({ db, now, userId: session.user.id }, (await ctx.params).circleId) }, { status: 201 }),
  );
}

export async function DELETE(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    await revokeCalendarFeed({ db, now, userId: session.user.id }, (await ctx.params).circleId);
    return new Response(null, { status: 204 });
  });
}
