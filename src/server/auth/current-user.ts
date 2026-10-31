import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { SESSION_COOKIE } from "./request";
import { validateSessionToken, type ValidatedSession } from "./session";

/** Session for the current page request, or null when signed out. Must render inside <Suspense>. */
export async function getCurrentSession(): Promise<ValidatedSession | null> {
  // Signed-in state depends on the request and the current time, so it is never prerendered.
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSessionToken(await getDb(), token, new Date());
}

/** Session for a page that requires sign-in; redirects to the login page otherwise. */
export async function requireSession(returnTo?: string): Promise<ValidatedSession> {
  const session = await getCurrentSession();
  if (!session) redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login");
  return session;
}

/** Only allow same-site relative paths as post-login destinations (prevents open redirects). */
export function safeReturnPath(next: string | string[] | undefined): string {
  const value = Array.isArray(next) ? next[0] : next;
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/app";
  return value;
}
