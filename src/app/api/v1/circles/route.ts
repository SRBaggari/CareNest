import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { createCircle, createCircleSchema, listMyCircles } from "@/server/services/circles";

export async function GET(request: Request) {
  return authedRoute(request, async ({ db, now, session }) =>
    Response.json({ circles: await listMyCircles({ db, now, userId: session.user.id }) }),
  );
}

export async function POST(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => {
    const input = await parseBody(request, createCircleSchema);
    const circle = await createCircle({ db, now, userId: session.user.id }, input);
    return Response.json({ circle }, { status: 201 });
  });
}
