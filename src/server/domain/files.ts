// Uploaded files: what they really are (from their first bytes, never the name or the browser's
// claim) and safe names for downloads. Pure.

export type FileType = { contentType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp"; extension: string };

/** PDF and the photo formats phones produce and browsers can show; anything else is refused. */
export function detectFileType(bytes: Uint8Array): FileType | null {
  const starts = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return { contentType: "application/pdf", extension: "pdf" }; // %PDF-
  if (starts([0xff, 0xd8, 0xff])) return { contentType: "image/jpeg", extension: "jpg" };
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { contentType: "image/png", extension: "png" };
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return { contentType: "image/webp", extension: "webp" }; // RIFF....WEBP
  return null;
}

/**
 * A file name safe to show and to send back in Content-Disposition: no paths, control characters or
 * quotes, at most 120 characters, and the extension that matches what the file really is.
 */
export function safeFilename(name: string, type: FileType): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(/\.[^.]*$/, "")
    .replace(/[\u0000-\u001f\u007f"<>|:*?\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${base || "document"}.${type.extension}`;
}

/** Content-Disposition with an ASCII fallback and the full UTF-8 name (RFC 6266 / 5987). */
export function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
