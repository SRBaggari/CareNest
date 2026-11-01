import { describe, expect, it } from "vitest";
import { requireUtf8 } from "./migrate";

describe("requireUtf8", () => {
  it("accepts a UTF8 database", () => {
    expect(() => requireUtf8("UTF8")).not.toThrow();
  });

  it("refuses character sets that can't store Hindi, Telugu or Tamil, and says how to fix it", () => {
    for (const encoding of ["WIN1252", "LATIN1", "SQL_ASCII"]) {
      expect(() => requireUtf8(encoding)).toThrow(/needs UTF8.*ENCODING 'UTF8'/);
    }
  });
});
