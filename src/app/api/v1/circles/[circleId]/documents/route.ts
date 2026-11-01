import { authedRoute } from "@/server/api";
import { listDocuments, uploadDocument } from "@/server/services/documents";
import { parseUpload } from "@/server/uploads";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/documents">;

export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) =>
    Response.json({ documents: await listDocuments({ db, now, userId: session.user.id }, (await ctx.params).circleId) }),
  );
}

/** multipart/form-data: file, title, category, note (optional). */
export async function POST(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const { fields, file } = await parseUpload(request);
    const document = await uploadDocument({ db, now, userId: session.user.id }, circleId, { title: fields.title ?? "", category: fields.category as never, note: fields.note }, file);
    return Response.json({ document }, { status: 201 });
  });
}
