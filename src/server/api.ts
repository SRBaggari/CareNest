import { getDb, type Db } from "@/server/db";
import { assertSameOrigin, getSessionToken } from "@/server/auth/request";
import { validateSessionToken, type ValidatedSession } from "@/server/auth/session";
import { AppError, handle } from "@/server/http";

export type RouteContext = { db: Db; now: Date; request: Request };
export type AuthedRouteContext = RouteContext & { session: ValidatedSession };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function checkOrigin(request: Request) {
  if (!SAFE_METHODS.has(request.method)) assertSameOrigin(request);
}

/** Route handler for endpoints that do not require a signed-in user (register, login). */
export function publicRoute(request: Request, fn: (ctx: RouteContext) => Promise<Response>): Promise<Response> {
  return handle(async () => {
    checkOrigin(request);
    return fn({ db: await getDb(), now: new Date(), request });
  });
}

/** Route handler that requires a valid session; responds 401 otherwise. */
export function authedRoute(
  request: Request,
  fn: (ctx: AuthedRouteContext) => Promise<Response>,
): Promise<Response> {
  return handle(async () => {
    checkOrigin(request);
    const db = await getDb();
    const now = new Date();
    const token = getSessionToken(request);
    const session = token ? await validateSessionToken(db, token, now) : null;
    if (!session) throw new AppError("unauthenticated", "Please sign in.");
    return fn({ db, now, request, session });
  });
}
