import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { getPreferences, preferencesSchema, updatePreferences } from "@/server/services/notifications";

export async function GET(request: Request) {
  return authedRoute(request, async ({ db, session }) => Response.json({ preferences: await getPreferences(db, session.user.id) }));
}

export async function PUT(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => {
    const input = await parseBody(request, preferencesSchema);
    return Response.json({ preferences: await updatePreferences({ db, now, userId: session.user.id }, input) });
  });
}
