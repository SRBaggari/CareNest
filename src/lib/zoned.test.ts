import { describe, expect, it } from "vitest";
import { isoToZonedInput, zonedInputToIso } from "./zoned";

describe("zoned datetime inputs", () => {
  it("interprets typed times in the recipient's zone, whatever the viewer's zone", () => {
    expect(zonedInputToIso("2026-11-16T10:00", "Asia/Kolkata")).toBe("2026-11-16T04:30:00.000Z");
    expect(zonedInputToIso("2026-11-16T10:00", "Europe/London")).toBe("2026-11-16T10:00:00.000Z");
  });

  it("round-trips for pre-filled forms", () => {
    expect(isoToZonedInput("2026-11-16T04:30:00.000Z", "Asia/Kolkata")).toBe("2026-11-16T10:00");
  });

  it("handles empty and invalid input", () => {
    expect(zonedInputToIso("", "UTC")).toBeNull();
    expect(zonedInputToIso("not a date", "UTC")).toBeNull();
    expect(isoToZonedInput(null, "UTC")).toBe("");
  });
});
