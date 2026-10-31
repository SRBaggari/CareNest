import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatLocalTime } from "./format";

const instant = new Date("2026-11-14T02:30:00Z");

describe("time formatting across zones", () => {
  it("shows the same instant as each viewer's wall-clock time", () => {
    expect(formatDateTime(instant, "en-GB", "Asia/Kolkata")).toBe("14 Nov 2026, 08:00");
    expect(formatDateTime(instant, "en-GB", "Europe/London")).toBe("14 Nov 2026, 02:30");
    expect(formatDateTime(instant, "en-GB", "America/Chicago")).toBe("13 Nov 2026, 20:30");
  });

  it("formats dates in the zone, which can change the calendar day", () => {
    expect(formatDate(instant, "en-GB", "America/Chicago")).toBe("13 Nov 2026");
  });

  it("labels local time with the zone so families abroad aren't confused", () => {
    expect(formatLocalTime(instant, "en-GB", "Europe/London")).toMatch(/02:30 (GMT|UTC)$/);
    expect(formatLocalTime(instant, "en-US", "America/Chicago")).toMatch(/CST$/);
  });
});
