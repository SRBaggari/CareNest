import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { contactSchema, createEmergencyContact, listEmergencyContacts } from "@/server/services/emergency";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/emergency/contacts">;

export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    return Response.json({ contacts: await listEmergencyContacts({ db, now, userId: session.user.id }, circleId) });
  });
}

export async function POST(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const input = await parseBody(request, contactSchema);
    return Response.json({ contacts: await createEmergencyContact({ db, now, userId: session.user.id }, circleId, input) }, { status: 201 });
  });
}
