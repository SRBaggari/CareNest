import { describe, expect, it } from "vitest";
import { CIRCLE_ROLES } from "@/server/auth/permissions";
import { canRecordStatus, daysOfSupply, doseSource, isOverdue, needsRefill, supplyDelta } from "./doses";

describe("canRecordStatus", () => {
  it("only someone other than the recipient can administer a dose", () => {
    expect(canRecordStatus("care_recipient", "administered")).toBe(false);
    expect(canRecordStatus("caregiver", "administered")).toBe(true);
    expect(canRecordStatus("family", "administered")).toBe(true);
    expect(canRecordStatus("admin", "administered")).toBe(true);
  });

  it("anyone allowed to record may record taken, skipped and refused", () => {
    for (const role of CIRCLE_ROLES) {
      for (const status of ["taken", "skipped", "refused"] as const) expect(canRecordStatus(role, status)).toBe(true);
    }
  });
});

describe("doseSource", () => {
  it("distinguishes self-reported, proxy-reported and caregiver records", () => {
    expect(doseSource("care_recipient", "taken")).toBe("self");
    expect(doseSource("family", "taken")).toBe("proxy");
    expect(doseSource("admin", "skipped")).toBe("proxy");
    expect(doseSource("caregiver", "taken")).toBe("caregiver");
    expect(doseSource("family", "administered")).toBe("caregiver");
  });
});

describe("isOverdue", () => {
  const at = new Date("2026-11-14T02:30:00Z");
  it("is false until the grace period has fully passed", () => {
    expect(isOverdue(at, new Date("2026-11-14T03:30:00Z"))).toBe(false);
    expect(isOverdue(at, new Date("2026-11-14T03:30:01Z"))).toBe(true);
    expect(isOverdue(at, new Date("2026-11-14T02:45:00Z"), 10)).toBe(true);
  });
});

describe("supply", () => {
  it("uses stock for taken/administered and gives it back when corrected", () => {
    expect(supplyDelta("scheduled", "taken", 1)).toBe(-1);
    expect(supplyDelta("unconfirmed", "administered", 2)).toBe(-2);
    expect(supplyDelta("taken", "skipped", 1)).toBe(1);
    expect(supplyDelta("taken", "administered", 1)).toBe(0);
    expect(supplyDelta("scheduled", "refused", 1)).toBe(0);
  });

  it("flags refills at or below the threshold only when both are known", () => {
    expect(needsRefill(5, 5)).toBe(true);
    expect(needsRefill(6, 5)).toBe(false);
    expect(needsRefill(null, 5)).toBe(false);
    expect(needsRefill(3, null)).toBe(false);
  });

  it("estimates days of supply", () => {
    expect(daysOfSupply(30, 2, 1)).toBe(15);
    expect(daysOfSupply(5, 2, 1)).toBe(2);
    expect(daysOfSupply(null, 2, 1)).toBeNull();
    expect(daysOfSupply(10, 0, 1)).toBeNull();
  });
});
