import { authedRoute } from "@/server/api";
import { contentDisposition } from "@/server/domain/files";
import { openDocumentFile } from "@/server/services/documents";

/**
 * The file itself (?version=<id> for an older one; ?download=1 to save rather than view). Every
 * opening is recorded. Served with a type checked at upload, never sniffed, never cached, and
 * sandboxed so a crafted file can't run script in CareNest's origin.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/circles/[circleId]/documents/[documentId]/file">) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, documentId } = await ctx.params;
    const url = new URL(request.url);
    const file = await openDocumentFile({ db, now, userId: session.user.id }, circleId, documentId, url.searchParams.get("version") ?? undefined);
    return new Response(file.bytes as unknown as BodyInit, {
      headers: {
        "content-type": file.contentType,
        "content-length": String(file.bytes.length),
        "content-disposition": contentDisposition(url.searchParams.get("download") === "1" ? "attachment" : "inline", file.filename),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
        "cross-origin-resource-policy": "same-origin",
      },
    });
  });
}
