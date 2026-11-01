import { describe, expect, it } from "vitest";
import { digestDueFor } from "./digest";

describe("digestDueFor", () => {
  it("is due from 18:00 in the person's own zone, not the server's", () => {
    // 12:29 UTC is 17:59 in Kolkata; 12:30 UTC is 18:00.
    expect(digestDueFor(new Date("2026-11-14T12:29:00Z"), "Asia/Kolkata", null)).toBeNull();
    expect(digestDueFor(new Date("2026-11-14T12:30:00Z"), "Asia/Kolkata", null)).toBe("2026-11-14");
    // The same instant is only 12:30 in London: not yet.
    expect(digestDueFor(new Date("2026-11-14T12:30:00Z"), "Europe/London", null)).toBeNull();
  });

  it("goes out once per local day", () => {
    const sent = new Date("2026-11-14T12:31:00Z"); // 18:01 in Kolkata
    expect(digestDueFor(new Date("2026-11-14T17:00:00Z"), "Asia/Kolkata", sent)).toBeNull(); // 22:30 the same day
    expect(digestDueFor(new Date("2026-11-15T12:30:00Z"), "Asia/Kolkata", sent)).toBe("2026-11-15"); // next evening
  });

  it("uses the local date, which can differ from the UTC date", () => {
    // 23:30 UTC on the 14th is already 05:00 on the 15th in Kolkata: the 15th's digest isn't due yet.
    expect(digestDueFor(new Date("2026-11-14T23:30:00Z"), "Asia/Kolkata", new Date("2026-11-14T12:30:00Z"))).toBeNull();
    // 01:00 UTC on the 15th is still 20:00 on the 14th in New York.
    expect(digestDueFor(new Date("2026-11-15T01:00:00Z"), "America/New_York", null)).toBe("2026-11-14");
  });

  it("keeps to 18:00 local across a daylight-saving change", () => {
    // London switches to GMT on 25 Oct 2026: 18:00 is 17:00 UTC before and 18:00 UTC after.
    expect(digestDueFor(new Date("2026-10-24T17:00:00Z"), "Europe/London", null)).toBe("2026-10-24");
    expect(digestDueFor(new Date("2026-10-26T17:00:00Z"), "Europe/London", null)).toBeNull();
    expect(digestDueFor(new Date("2026-10-26T18:00:00Z"), "Europe/London", null)).toBe("2026-10-26");
  });
});
