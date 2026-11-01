import { describe, expect, it } from "vitest";
import { contentDisposition, detectFileType, safeFilename } from "./files";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
const text = (s: string) => new TextEncoder().encode(s);

describe("detectFileType", () => {
  it("recognises PDFs and the photo formats phones produce, from their contents", () => {
    expect(detectFileType(text("%PDF-1.7\n..."))?.contentType).toBe("application/pdf");
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0))?.contentType).toBe("image/jpeg");
    expect(detectFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))?.contentType).toBe("image/png");
    expect(detectFileType(text("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))?.contentType).toBe("image/webp");
  });

  it("refuses everything else, whatever it is called", () => {
    expect(detectFileType(text("MZ\u0090\u0000"))).toBeNull(); // a Windows program
    expect(detectFileType(text("<html><script>alert(1)</script>"))).toBeNull();
    expect(detectFileType(text("<svg xmlns='http://www.w3.org/2000/svg'>"))).toBeNull(); // SVG can carry scripts
    expect(detectFileType(text("PK\u0003\u0004"))).toBeNull(); // zip / docx
    expect(detectFileType(new Uint8Array())).toBeNull();
  });
});

describe("safe file names", () => {
  const pdf = { contentType: "application/pdf", extension: "pdf" } as const;

  it("drops paths and dangerous characters and uses the real extension", () => {
    expect(safeFilename("C:\\Users\\me\\Discharge summary.exe", pdf)).toBe("Discharge summary.pdf");
    expect(safeFilename("../../etc/passwd", pdf)).toBe("passwd.pdf");
    // No quote survives, so a name can't break out of the Content-Disposition header.
    expect(safeFilename('report"; filename="evil.html', pdf)).not.toContain('"');
    expect(safeFilename("", pdf)).toBe("document.pdf");
    expect(safeFilename("అమ్మ రిపోర్ట్.pdf", pdf)).toBe("అమ్మ రిపోర్ట్.pdf");
  });

  it("sends Indian-language names intact, with a plain fallback for old browsers", () => {
    const header = contentDisposition("inline", "అమ్మ రిపోర్ట్.pdf");
    expect(header).toMatch(/^inline; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    expect(decodeURIComponent(header.split("UTF-8''")[1])).toBe("అమ్మ రిపోర్ట్.pdf");
  });
});
