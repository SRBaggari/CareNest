import { AppError } from "@/server/http";
import { MAX_DOCUMENT_BYTES, type UploadedFile } from "@/server/services/documents";

/**
 * Reads a multipart upload with one file field ("file") and text fields. Requests larger than the
 * limit are refused before the body is read, so a huge upload can't exhaust the server's memory.
 */
export async function parseUpload(request: Request): Promise<{ fields: Record<string, string>; file: UploadedFile }> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    throw new AppError("unsupported_media_type", "Send the file as multipart/form-data.");
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_DOCUMENT_BYTES + 64 * 1024) {
    throw new AppError("validation_failed", "Some fields are invalid.", { file: ["That file is larger than 10 MB. Try a smaller photo or scan."] });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AppError("validation_failed", "Some fields are invalid.", { file: ["The upload couldn't be read. Try again."] });
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("validation_failed", "Some fields are invalid.", { file: ["Choose a file to upload."] });
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") fields[key] = value;
  return { fields, file: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } };
}
