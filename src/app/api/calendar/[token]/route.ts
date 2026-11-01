import { publicRoute } from "@/server/api";
import { calendarForToken } from "@/server/services/calendar";

/**
 * The calendar file that Google/Apple/Outlook fetch. No cookies come with these requests: the long
 * random link is the key. Unknown, revoked or no-longer-valid links all get the same plain 404.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/calendar/[token]">) {
  return publicRoute(request, async ({ db, now }) => {
    const token = (await ctx.params).token.replace(/\.ics$/, "");
    const ics = await calendarForToken(db, token, now);
    if (!ics) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    return new Response(ics, {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'inline; filename="carenest.ics"',
        "cache-control": "private, no-store",
        "x-robots-tag": "noindex",
      },
    });
  });
}
