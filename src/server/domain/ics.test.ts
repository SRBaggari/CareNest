import { describe, expect, it } from "vitest";
import { buildCalendar, escapeText, foldLine, icsDate } from "./ics";

describe("iCalendar output", () => {
  it("escapes text the way calendar apps expect", () => {
    expect(escapeText("Dr. Rao, Apollo; Room 4\nBring reports\\scans")).toBe("Dr. Rao\\, Apollo\\; Room 4\\nBring reports\\\\scans");
  });

  it("writes times in UTC", () => {
    expect(icsDate(new Date("2026-11-14T09:00:00+05:30"))).toBe("20261114T033000Z");
  });

  it("folds long lines at 75 bytes without splitting a Telugu letter", () => {
    const line = `SUMMARY:${"అపాయింట్‌మెంట్ ".repeat(8)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const [i, part] of parts.entries()) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
      if (i > 0) expect(part.startsWith(" ")).toBe(true);
    }
    // Unfolding gives back exactly the original text, with every character intact.
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("builds a calendar with stable ids, cancellations and CRLF line endings", () => {
    const ics = buildCalendar({
      name: "CareNest – Amma's care",
      stamp: new Date("2026-11-01T00:00:00Z"),
      events: [
        { uid: "appointment-1@carenest", start: new Date("2026-11-14T04:00:00Z"), end: new Date("2026-11-14T05:00:00Z"), summary: "Cardiology", location: "Apollo, Jubilee Hills", sequence: 2 },
        { uid: "appointment-2@carenest", start: new Date("2026-11-15T04:00:00Z"), end: new Date("2026-11-15T05:00:00Z"), summary: "Eye test", cancelled: true },
      ],
    });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(ics).toContain("UID:appointment-1@carenest\r\n");
    expect(ics).toContain("LOCATION:Apollo\\, Jubilee Hills\r\n");
    expect(ics).toContain("SEQUENCE:2\r\n");
    expect(ics.split("BEGIN:VEVENT")[2]).toContain("STATUS:CANCELLED");
    expect(ics).toContain("X-WR-CALNAME:CareNest – Amma's care");
  });
});
