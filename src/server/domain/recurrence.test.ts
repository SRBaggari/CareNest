import { describe, expect, it } from "vitest";
import { nextOccurrence } from "./recurrence";

const d = (iso: string) => new Date(iso);

describe("nextOccurrence", () => {
  it("returns null for one-off tasks", () => {
    expect(nextOccurrence(d("2026-11-14T04:30:00Z"), "none", "Asia/Kolkata", d("2026-11-14T05:00:00Z"))).toBeNull();
  });

  it("advances daily, weekly and monthly", () => {
    const due = d("2026-11-14T04:30:00Z");
    const now = d("2026-11-14T05:00:00Z");
    expect(nextOccurrence(due, "daily", "Asia/Kolkata", now)?.toISOString()).toBe("2026-11-15T04:30:00.000Z");
    expect(nextOccurrence(due, "weekly", "Asia/Kolkata", now)?.toISOString()).toBe("2026-11-21T04:30:00.000Z");
    expect(nextOccurrence(due, "monthly", "Asia/Kolkata", now)?.toISOString()).toBe("2026-12-14T04:30:00.000Z");
  });

  it("keeps the local time across DST", () => {
    // 09:00 New York, weekly, across the 2026-11-01 fall-back.
    const next = nextOccurrence(d("2026-10-29T13:00:00Z"), "weekly", "America/New_York", d("2026-10-29T14:00:00Z"));
    expect(next?.toISOString()).toBe("2026-11-05T14:00:00.000Z");
  });

  it("clamps month ends", () => {
    expect(nextOccurrence(d("2027-01-31T06:00:00Z"), "monthly", "UTC", d("2027-01-31T07:00:00Z"))?.toISOString()).toBe("2027-02-28T06:00:00.000Z");
  });

  it("skips missed occurrences instead of piling up overdue copies", () => {
    const next = nextOccurrence(d("2026-11-01T04:30:00Z"), "daily", "Asia/Kolkata", d("2026-11-14T05:00:00Z"));
    expect(next?.toISOString()).toBe("2026-11-15T04:30:00.000Z");
  });
});
