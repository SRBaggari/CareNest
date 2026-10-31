import { describe, expect, it } from "vitest";
import { DOSE_STATUSES } from "@/server/domain/doses";
import { displayStatus, formatClock, STATUS_SYMBOL, STATUS_TONE } from "./dose-display";

const now = new Date("2026-11-14T03:00:00Z");

describe("displayStatus", () => {
  it("shows future scheduled doses as upcoming and past ones as due", () => {
    expect(displayStatus({ status: "scheduled", scheduledFor: "2026-11-14T14:30:00Z", reminderSentAt: null }, now)).toBe("upcoming");
    expect(displayStatus({ status: "scheduled", scheduledFor: "2026-11-14T02:30:00Z", reminderSentAt: null }, now)).toBe("scheduled");
  });

  it("shows that a reminder went out, which is not the same as a confirmation", () => {
    expect(displayStatus({ status: "scheduled", scheduledFor: "2026-11-14T02:30:00Z", reminderSentAt: "2026-11-14T02:30:00Z" }, now)).toBe(
      "reminded",
    );
  });

  it("passes recorded and unconfirmed statuses through unchanged", () => {
    for (const status of DOSE_STATUSES.filter((s) => s !== "scheduled")) {
      expect(displayStatus({ status, scheduledFor: null, reminderSentAt: null }, now)).toBe(status);
    }
  });

  it("gives every status a tone and a non-colour symbol", () => {
    for (const status of Object.keys(STATUS_TONE)) {
      expect(STATUS_SYMBOL[status as keyof typeof STATUS_SYMBOL]).toBeTruthy();
    }
    expect(STATUS_TONE.unconfirmed).toBe("warning");
    expect(STATUS_TONE.taken).toBe("success");
  });
});

describe("formatClock", () => {
  it("formats in the given zone", () => {
    expect(formatClock("2026-11-14T02:30:00Z", "en-GB", "Asia/Kolkata")).toBe("08:00");
    expect(formatClock("2026-11-14T02:30:00Z", "en-GB", "Europe/London")).toBe("02:30");
  });
});
