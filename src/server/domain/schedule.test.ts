import { describe, expect, it } from "vitest";
import { addDays, expandSchedule, isValidLocalDate, localDateIn, localDayBounds, localToInstant, type ScheduleSpec } from "./schedule";

const daily = (times: string[], extra: Partial<ScheduleSpec> = {}): ScheduleSpec => ({
  times,
  daysOfWeek: null,
  startDate: "2026-01-01",
  endDate: null,
  asNeeded: false,
  ...extra,
});
const iso = (d: Date) => d.toISOString();

describe("expandSchedule", () => {
  it("anchors doses to the recipient's zone (India, no DST)", () => {
    const doses = expandSchedule(daily(["08:00", "20:00"]), "Asia/Kolkata", "2026-11-14", "2026-11-14");
    expect(doses.map((d) => iso(d.scheduledFor))).toEqual(["2026-11-14T02:30:00.000Z", "2026-11-14T14:30:00.000Z"]);
    expect(doses.every((d) => !d.shifted)).toBe(true);
  });

  it("sorts and de-duplicates times", () => {
    const doses = expandSchedule(daily(["20:00", "08:00", "08:00"]), "UTC", "2026-11-14", "2026-11-14");
    expect(doses.map((d) => d.localTime)).toEqual(["08:00", "20:00"]);
  });

  it("covers every day in the range and respects start and end dates", () => {
    const spec = daily(["09:00"], { startDate: "2026-11-02", endDate: "2026-11-04" });
    const doses = expandSchedule(spec, "UTC", "2026-11-01", "2026-11-10");
    expect(doses.map((d) => d.localDate)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(expandSchedule(spec, "UTC", "2026-11-05", "2026-11-10")).toEqual([]);
  });

  it("filters by ISO weekday", () => {
    // 2026-11-16 is a Monday.
    const spec = daily(["09:00"], { daysOfWeek: [1, 3, 5] });
    const doses = expandSchedule(spec, "Asia/Kolkata", "2026-11-16", "2026-11-22");
    expect(doses.map((d) => d.localDate)).toEqual(["2026-11-16", "2026-11-18", "2026-11-20"]);
  });

  it("produces nothing for as-needed medicines", () => {
    expect(expandSchedule(daily(["09:00"], { asNeeded: true }), "UTC", "2026-11-01", "2026-11-30")).toEqual([]);
    expect(expandSchedule(daily([]), "UTC", "2026-11-01", "2026-11-30")).toEqual([]);
  });

  it("keeps 08:00 local across the US spring-forward change (offset changes, local time doesn't)", () => {
    const doses = expandSchedule(daily(["08:00"]), "America/New_York", "2027-03-13", "2027-03-15");
    expect(doses.map((d) => iso(d.scheduledFor))).toEqual([
      "2027-03-13T13:00:00.000Z", // EST, UTC-5
      "2027-03-14T12:00:00.000Z", // EDT, UTC-4
      "2027-03-15T12:00:00.000Z",
    ]);
  });

  it("moves a dose written inside the spring-forward gap to after it, and flags it", () => {
    // 02:30 does not exist in New York on 2027-03-14.
    const [gap] = expandSchedule(daily(["02:30"]), "America/New_York", "2027-03-14", "2027-03-14");
    expect(gap.shifted).toBe(true);
    expect(iso(gap.scheduledFor)).toBe("2027-03-14T07:30:00.000Z"); // 03:30 EDT
  });

  it("gives exactly one dose for a time that occurs twice when clocks fall back", () => {
    // 01:30 happens twice in London on 2026-10-25.
    const doses = expandSchedule(daily(["01:30"]), "Europe/London", "2026-10-25", "2026-10-25");
    expect(doses).toHaveLength(1);
    expect(doses[0].shifted).toBe(false);
  });
});

describe("local day helpers", () => {
  it("knows the recipient's date even when it differs from UTC", () => {
    const now = new Date("2026-11-14T20:00:00Z");
    expect(localDateIn("Asia/Kolkata", now)).toBe("2026-11-15");
    expect(localDateIn("America/Chicago", now)).toBe("2026-11-14");
  });

  it("returns 23- and 25-hour days around DST transitions", () => {
    const hours = (d: string, tz: string) => {
      const { start, end } = localDayBounds(d, tz);
      return (end.getTime() - start.getTime()) / 3_600_000;
    };
    expect(hours("2027-03-14", "America/New_York")).toBe(23);
    expect(hours("2026-11-01", "America/New_York")).toBe(25);
    expect(hours("2026-11-14", "Asia/Kolkata")).toBe(24);
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("localToInstant does not shift ordinary times", () => {
    expect(localToInstant("2026-11-14", "08:00", "Asia/Kolkata")).toEqual({
      instant: new Date("2026-11-14T02:30:00Z"),
      shifted: false,
    });
  });
});

describe("regressions from black-box testing", () => {
  it("F1: expanding near year 9999 terminates (string-compared dates once looped forever)", () => {
    const start = Date.now();
    const doses = expandSchedule(daily(["08:00"]), "UTC", "9999-12-31", "9999-12-31");
    expect(doses).toHaveLength(1);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("refuses to expand unreasonably long ranges", () => {
    expect(() => expandSchedule(daily(["08:00"]), "UTC", "2026-01-01", "2030-01-01")).toThrow(RangeError);
  });

  it("F2: only real calendar dates within 1900–2200 are valid", () => {
    expect(isValidLocalDate("2026-11-14")).toBe(true);
    expect(isValidLocalDate("2028-02-29")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-45", "0000-00-00", "9999-12-31", "1899-12-31", "2201-01-01", "2026-1-5", "abc"]) {
      expect([bad, isValidLocalDate(bad)]).toEqual([bad, false]);
    }
  });
});
