import { authedRoute } from "@/server/api";
import { parseBody } from "@/server/http";
import { updateProfile, updateProfileSchema } from "@/server/services/accounts";

export async function GET(request: Request) {
  return authedRoute(request, async ({ session }) => Response.json({ user: session.user }));
}

export async function PATCH(request: Request) {
  return authedRoute(request, async ({ db, now, session }) => {
    const input = await parseBody(request, updateProfileSchema);
    const user = await updateProfile(db, session.user.id, input, now);
    return Response.json({ user });
  });
}
