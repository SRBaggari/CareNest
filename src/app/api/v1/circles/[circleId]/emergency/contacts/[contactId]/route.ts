import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { deleteEmergencyContact, updateContactSchema, updateEmergencyContact } from "@/server/services/emergency";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/emergency/contacts/[contactId]">;

export async function PATCH(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, contactId } = await ctx.params;
    const input = await parseBody(request, updateContactSchema);
    return Response.json({ contacts: await updateEmergencyContact({ db, now, userId: session.user.id }, circleId, contactId, input) });
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId, contactId } = await ctx.params;
    await deleteEmergencyContact({ db, now, userId: session.user.id }, circleId, contactId);
    return new Response(null, { status: 204 });
  });
}
