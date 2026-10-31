import "server-only";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError } from "@/server/http";
import type { ServiceContext } from "@/server/services/access";

/** Signed-in context for server components: same services and authorization as the API. */
export async function pageContext(returnTo: string) {
  const session = await requireSession(returnTo);
  const ctx: ServiceContext = { db: await getDb(), now: new Date(), userId: session.user.id };
  return { session, ctx };
}

/** Renders the 404 page for not-found service errors (including circles the user isn't in). */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  }
}

/** Returns null instead of throwing when the user lacks permission, so pages can show a message. */
export async function orForbidden<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof AppError && err.code === "forbidden") return null;
    throw err;
  }
}
