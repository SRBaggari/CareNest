import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

export type ErrorCode =
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation_failed"
  | "rate_limited"
  | "unsupported_media_type"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation_failed: 422,
  rate_limited: 429,
  unsupported_media_type: 415,
  internal: 500,
};

/** Error thrown by services; mapped to a JSON error response by `handle`. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function errorResponse(err: AppError): Response {
  const body: { error: { code: ErrorCode; message: string; details?: unknown } } = {
    error: { code: err.code, message: err.message },
  };
  if (err.details !== undefined) body.error.details = err.details;
  const retryAfter = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
  return Response.json(body, {
    status: err.status,
    headers: err.code === "rate_limited" && retryAfter ? { "Retry-After": String(retryAfter) } : undefined,
  });
}

/** Wraps a route handler: maps AppError/ZodError to JSON errors and hides internal failures. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    // Let Next.js control-flow errors (dynamic bail-out during prerender, redirect, notFound) through.
    unstable_rethrow(err);
    if (err instanceof AppError) return errorResponse(err);
    if (err instanceof z.ZodError) {
      return errorResponse(new AppError("validation_failed", "Some fields are invalid.", fieldErrors(err)));
    }
    console.error("Unhandled API error", err);
    return errorResponse(new AppError("internal", "Something went wrong. Please try again."));
  }
}

/** Groups Zod issues by dotted field path (e.g. "recipient.timeZone") so forms can place each message. */
export function fieldErrors(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.map(String).join(".") || "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Parses a JSON request body against a schema; malformed JSON is a 400, invalid fields a 422. */
export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new AppError("unsupported_media_type", "Send the request body as JSON (Content-Type: application/json).");
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError("bad_request", "Request body must be valid JSON.");
  }
  return schema.parse(raw);
}
