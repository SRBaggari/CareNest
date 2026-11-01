import { authedRoute } from "@/server/api";
import { exportMyData } from "@/server/services/data-rights";

/** Download everything CareNest holds about me, as JSON. */
export async function GET(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => {
    const data = await exportMyData({ db, now, userId: session.user.id });
    return Response.json(data, {
      headers: { "Content-Disposition": `attachment; filename="carenest-my-data-${now.toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" },
    });
  });
}
