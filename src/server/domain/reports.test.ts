import { describe, expect, it } from "vitest";
import { daysBetween, MAX_REPORT_DAYS, resolvePeriod, tallyDoses, toCsv } from "./reports";

describe("report period", () => {
  const today = "2026-11-14";

  it("defaults to the last 30 days, ending today", () => {
    expect(resolvePeriod({}, today)).toEqual({ ok: true, period: { from: "2026-10-16", to: today } });
    expect(daysBetween("2026-10-16", today)).toBe(30);
  });

  it("counts both ends, and a single day is allowed", () => {
    expect(resolvePeriod({ from: today, to: today }, today)).toEqual({ ok: true, period: { from: today, to: today } });
    expect(daysBetween(today, today)).toBe(1);
  });

  it("refuses the future, a backwards period and anything longer than the limit", () => {
    expect(resolvePeriod({ to: "2026-11-15" }, today)).toMatchObject({ ok: false, errors: { to: expect.any(Array) } });
    expect(resolvePeriod({ from: "2026-11-10", to: "2026-11-01" }, today)).toMatchObject({ ok: false, errors: { from: expect.any(Array) } });
    const longest = resolvePeriod({ from: "2026-08-15", to: today }, today);
    expect(longest.ok && daysBetween(longest.period.from, longest.period.to)).toBe(MAX_REPORT_DAYS);
    expect(resolvePeriod({ from: "2026-08-14", to: today }, today).ok).toBe(false);
  });

  it("rejects dates that don't exist", () => {
    expect(resolvePeriod({ from: "2026-02-30", to: "2026-03-01" }, today)).toMatchObject({ ok: false, errors: { from: ["Enter a valid date."] } });
    expect(resolvePeriod({ from: "yesterday" }, today).ok).toBe(false);
  });
});

describe("dose tally", () => {
  it("counts each outcome per medicine, keeping unconfirmed and not-yet-due apart", () => {
    const tally = tallyDoses([
      { medicationId: "m", status: "taken", scheduled: true },
      { medicationId: "m", status: "administered", scheduled: true },
      { medicationId: "m", status: "skipped", scheduled: true },
      { medicationId: "m", status: "refused", scheduled: true },
      { medicationId: "m", status: "unconfirmed", scheduled: true },
      { medicationId: "m", status: "scheduled", scheduled: true },
      { medicationId: "p", status: "taken", scheduled: false },
      { medicationId: "p", status: "taken", scheduled: false },
    ]);
    expect(tally.get("m")).toEqual({ scheduled: 6, taken: 1, administered: 1, skipped: 1, refused: 1, unconfirmed: 1, pending: 1, asNeeded: 0 });
    expect(tally.get("p")).toMatchObject({ scheduled: 0, asNeeded: 2 });
  });

  it("is empty when nothing was recorded", () => {
    expect(tallyDoses([]).size).toBe(0);
  });
});

describe("CSV", () => {
  it("quotes commas, quotes and line breaks, and ends lines with CRLF", () => {
    expect(toCsv([["a", "b,c", 'say "hi"', "two\nlines"]])).toBe('a,"b,c","say ""hi""","two\nlines"\r\n');
  });

  it("writes numbers as numbers and leaves missing values empty", () => {
    expect(toCsv([[132, 84.5, null, undefined, Number.NaN]])).toBe("132,84.5,,,\r\n");
  });

  it("never lets a note run as a spreadsheet formula", () => {
    const out = toCsv([["=HYPERLINK(\"http://x\")", "+1", "-2", "@SUM(A1)", "\tx"]]);
    expect(out).toBe(`"'=HYPERLINK(""http://x"")",'+1,'-2,'@SUM(A1),'\tx\r\n`);
    // A negative number is a value, not text, and stays a number.
    expect(toCsv([[-3]])).toBe("-3\r\n");
  });

  it("keeps Indian scripts as they are", () => {
    expect(toCsv([["ఒంట్లో బాలేదు"]])).toBe("ఒంట్లో బాలేదు\r\n");
  });
});
