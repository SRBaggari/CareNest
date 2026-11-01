import { authedRoute } from "@/server/api";
import { getDocument, removeDocument } from "@/server/services/documents";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/documents/[documentId]">;

/** Versions and who has opened the document. */
export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, documentId } = await ctx.params;
    return Response.json({ document: await getDocument({ db, now, userId: session.user.id }, circleId, documentId) });
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, documentId } = await ctx.params;
    await removeDocument({ db, now, userId: session.user.id }, circleId, documentId);
    return new Response(null, { status: 204 });
  });
}
