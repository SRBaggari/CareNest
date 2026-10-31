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
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation_failed: 422,
  rate_limited: 429,
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
  return Response.json(body, { status: err.status });
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
      return errorResponse(
        new AppError("validation_failed", "Some fields are invalid.", z.flattenError(err).fieldErrors),
      );
    }
    console.error("Unhandled API error", err);
    return errorResponse(new AppError("internal", "Something went wrong. Please try again."));
  }
}

/** Parses a JSON request body against a schema; malformed JSON is a 400, invalid fields a 422. */
export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError("bad_request", "Request body must be valid JSON.");
  }
  return schema.parse(raw);
}
