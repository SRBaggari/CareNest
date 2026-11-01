import { describe, expect, it } from "vitest";
import { maskPhone, normalizePhone } from "./phone";

describe("phone numbers", () => {
  it("stores numbers in international form, however they were typed", () => {
    expect(normalizePhone("+91 90000 00001")).toBe("+919000000001");
    expect(normalizePhone("0091-90000-00001")).toBe("+919000000001");
    expect(normalizePhone("+44 (0)7700 900123")).toBe("+447700900123");
    expect(normalizePhone("+1 (415) 555-0100")).toBe("+14155550100");
  });

  it("needs the country code, and refuses numbers that can't be real", () => {
    for (const bad of ["9000000001", "09000000001", "+91 12345 67890", "+91 9000", "+0 1234 5678", "+91 90000 000011", "call me", ""]) {
      expect([bad, normalizePhone(bad)]).toEqual([bad, null]);
    }
  });

  it("shows only the last four digits", () => {
    expect(maskPhone("+919000000001")).toBe("+91 ••••• •0001");
    expect(maskPhone("+447700900123")).toBe("+44 ••••• •0123");
    expect(maskPhone("+14155550100")).toBe("+1 ••••• •0100");
  });
});
