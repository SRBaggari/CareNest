import { authedRoute } from "@/server/api";
import { addDocumentVersion } from "@/server/services/documents";
import { parseUpload } from "@/server/uploads";

/** A newer copy of the document (multipart/form-data: file, note optional). */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/documents/[documentId]/versions">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, documentId } = await ctx.params;
    const { fields, file } = await parseUpload(request);
    const version = await addDocumentVersion({ db, now, userId: session.user.id }, circleId, documentId, { note: fields.note }, file);
    return Response.json({ version }, { status: 201 });
  });
}
