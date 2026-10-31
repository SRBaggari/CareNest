import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./current-user";

describe("safeReturnPath", () => {
  it("keeps same-site relative paths", () => {
    expect(safeReturnPath("/app/account")).toBe("/app/account");
    expect(safeReturnPath(["/app/circles", "/other"])).toBe("/app/circles");
  });

  it("refuses absolute and protocol-relative URLs (open redirect)", () => {
    for (const evil of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      expect(safeReturnPath(evil)).toBe("/app");
    }
  });

  it("defaults to the app home", () => {
    expect(safeReturnPath(undefined)).toBe("/app");
    expect(safeReturnPath("")).toBe("/app");
  });
});
