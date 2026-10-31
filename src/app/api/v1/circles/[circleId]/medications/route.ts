import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { createMedication, createMedicationSchema, listMedications } from "@/server/services/medications";

type Ctx = RouteContext<"/api/v1/circles/[circleId]/medications">;

export async function GET(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const includeStopped = new URL(request.url).searchParams.get("includeStopped") === "true";
    const list = await listMedications({ db, now, userId: session.user.id }, circleId, { includeStopped });
    return Response.json({ medications: list });
  });
}

export async function POST(request: Request, ctx: Ctx) {
  return authedRoute(request, async ({ db, now, session }) => {
    const { circleId } = await ctx.params;
    const input = await parseBody(request, createMedicationSchema);
    const medication = await createMedication({ db, now, userId: session.user.id }, circleId, input);
    return Response.json({ medication }, { status: 201 });
  });
}
