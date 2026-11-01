import { AppError, errorResponse } from "@/server/http";

/** Unknown API paths answer in the same JSON error format as the rest of the API. */
function notFound(request: Request) {
  void request.headers;
  return errorResponse(new AppError("not_found", "There is no such API endpoint."));
}

export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE };
