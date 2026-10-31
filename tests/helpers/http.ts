import { randomInt } from "node:crypto";
import { SESSION_COOKIE } from "@/server/auth/request";

export const BASE_URL = "http://localhost";

type RequestOptions = {
  body?: unknown;
  /** `name=value` cookie pair, e.g. from `sessionCookieFrom`. */
  cookie?: string;
  /** Defaults to the app's own origin; pass null to omit the header. */
  origin?: string | null;
  ip?: string;
  headers?: Record<string, string>;
};

/** Builds a Request like the browser would send to a route handler. */
export function apiRequest(method: string, path: string, options: RequestOptions = {}): Request {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  const origin = options.origin === undefined ? BASE_URL : options.origin;
  if (origin) headers.set("origin", origin);
  // A random client IP per request unless specified, so per-IP rate limits don't couple tests.
  headers.set("x-forwarded-for", options.ip ?? `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`);
  return new Request(`${BASE_URL}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

/** Extracts the `name=value` session cookie pair from a response's Set-Cookie header. */
export function sessionCookieFrom(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  const pair = header.split(";")[0];
  if (!pair.startsWith(`${SESSION_COOKIE}=`) || pair === `${SESSION_COOKIE}=`) {
    throw new Error(`No session cookie in response (status ${res.status}): ${header}`);
  }
  return pair;
}

/** Route context with already-resolved dynamic params, as Next.js passes them. */
export function params<T extends Record<string, string>>(values: T) {
  return { params: Promise.resolve(values) };
}
