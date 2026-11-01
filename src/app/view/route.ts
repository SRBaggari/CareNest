import { safeReturnPath } from "@/server/auth/current-user";

export const VIEW_COOKIE = "cn_view";

/**
 * Switches between the Simple view (large, one screen, for the person receiving care) and the
 * full app, and remembers the choice on this device: /view?mode=simple|full&next=/path
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "full" ? "full" : "simple";
  const next = safeReturnPath(url.searchParams.get("next") ?? undefined);
  const secure = process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true";
  return new Response(null, {
    status: 303,
    headers: {
      Location: next,
      "Set-Cookie": `${VIEW_COOKIE}=${mode}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`,
    },
  });
}
