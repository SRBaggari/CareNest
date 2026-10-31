import { AppError } from "@/server/http";

const SECURE_COOKIES = process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true";

/** `__Host-` prefix forces Secure, Path=/ and no Domain — only possible over HTTPS. */
export const SESSION_COOKIE = SECURE_COOKIES ? "__Host-cn_session" : "cn_session";

export function readCookie(cookieHeader: string | null | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function getSessionToken(request: Request): string | undefined {
  return readCookie(request.headers.get("cookie"), SESSION_COOKIE);
}

export function sessionCookie(token: string, expiresAt: Date): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (SECURE_COOKIES) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (SECURE_COOKIES) parts.push("Secure");
  return parts.join("; ");
}

/** Best-effort client IP for rate limiting. Assumes a trusted reverse proxy sets X-Forwarded-For. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * CSRF defence for cookie-authenticated mutations (in addition to SameSite=Lax): the Origin
 * header must be this app's own origin. Browsers always send Origin on cross-site POSTs.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const allowed = new Set([new URL(request.url).origin]);
  if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).origin);
  if (!origin || !allowed.has(origin)) {
    throw new AppError("forbidden", "This request did not come from CareNest.");
  }
}

/** Public origin for links we hand out (invitations, notifications). */
export function appOrigin(request: Request): string {
  return process.env.APP_URL ? new URL(process.env.APP_URL).origin : new URL(request.url).origin;
}
