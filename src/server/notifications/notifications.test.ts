import { describe, expect, it } from "vitest";
import { effectiveAlertSettings, offersChoice, wantsAlert } from "./alert-settings";
import { quietUntil } from "./quiet-hours";

describe("quietUntil", () => {
  const at = (iso: string) => new Date(iso);

  it("handles quiet hours that cross midnight, in the user's zone", () => {
    // 23:30 in Kolkata = 18:00Z
    expect(quietUntil(at("2026-11-14T18:00:00Z"), "Asia/Kolkata", "22:00", "07:00")?.toISOString()).toBe("2026-11-15T01:30:00.000Z");
    // 06:59 in Kolkata, still quiet, ends at 07:00 the same morning
    expect(quietUntil(at("2026-11-15T01:29:00Z"), "Asia/Kolkata", "22:00", "07:00")?.toISOString()).toBe("2026-11-15T01:30:00.000Z");
    // 07:00 is not quiet any more
    expect(quietUntil(at("2026-11-15T01:30:00Z"), "Asia/Kolkata", "22:00", "07:00")).toBeNull();
  });

  it("handles same-day windows", () => {
    expect(quietUntil(at("2026-11-14T13:30:00Z"), "UTC", "13:00", "15:00")?.toISOString()).toBe("2026-11-14T15:00:00.000Z");
    expect(quietUntil(at("2026-11-14T15:30:00Z"), "UTC", "13:00", "15:00")).toBeNull();
  });

  it("is never quiet when unset or empty", () => {
    expect(quietUntil(at("2026-11-14T23:00:00Z"), "UTC", null, null)).toBeNull();
    expect(quietUntil(at("2026-11-14T23:00:00Z"), "UTC", "22:00", "22:00")).toBeNull();
  });

  it("uses the user's zone, not the server's", () => {
    // 23:00 in London is 04:30 next day in Kolkata.
    expect(quietUntil(at("2026-11-14T23:00:00Z"), "Europe/London", "22:00", "07:00")).not.toBeNull();
    expect(quietUntil(at("2026-11-14T23:00:00Z"), "Asia/Kolkata", "22:00", "04:00")).toBeNull();
  });
});

describe("alert settings", () => {
  const none = { notifyDoseReminders: null, notifyUnconfirmedDoses: null, notifyRefills: null, notifyAppointments: null, notifyTasks: null };

  it("uses role defaults", () => {
    expect(effectiveAlertSettings("care_recipient", none)).toEqual({ doseReminders: true, unconfirmedDoses: false, refills: false, appointments: true, tasks: false });
    expect(effectiveAlertSettings("family", none)).toEqual({ doseReminders: false, unconfirmedDoses: true, refills: true, appointments: true, tasks: true });
    expect(effectiveAlertSettings("emergency_contact", none)).toEqual({ doseReminders: false, unconfirmedDoses: false, refills: false, appointments: false, tasks: false });
  });

  it("offers appointment and task choices only to roles those alerts can reach", () => {
    expect(offersChoice("care_recipient", "appointments")).toBe(true);
    expect(offersChoice("family", "tasks")).toBe(true);
    expect(offersChoice("caregiver", "tasks")).toBe(false);
    expect(offersChoice("clinician", "appointments")).toBe(false);
    expect(offersChoice("emergency_contact", "doseReminders")).toBe(true);
  });

  it("lets each person override their own defaults", () => {
    expect(wantsAlert("family", { ...none, notifyUnconfirmedDoses: false }, "unconfirmedDoses")).toBe(false);
    expect(wantsAlert("clinician", { ...none, notifyRefills: true }, "refills")).toBe(true);
  });
});
