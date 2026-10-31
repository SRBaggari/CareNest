import { describe, expect, it } from "vitest";
import {
  can,
  CAPABILITIES,
  capabilitiesFor,
  CIRCLE_ROLES,
  DEFAULT_CONSENT,
  hasManager,
  type Capability,
  type CircleRole,
  type Consent,
} from "./permissions";

const member = (role: CircleRole, isLegalRepresentative = false) => ({ role, isLegalRepresentative });
const profile = (selfManaging = true, consent: Partial<Consent> = {}) => ({
  selfManaging,
  consent: { ...DEFAULT_CONSENT, ...consent },
});

// Expected matrix with full sharing and a self-managing recipient (docs/PLAN.md §4).
const Y = true;
const N = false;
//                                recipient admin family caregiver clinician emergency
const EXPECTED: Record<Capability, [boolean, boolean, boolean, boolean, boolean, boolean]> = {
  "circle.view":                  [Y, Y, Y, Y, Y, Y],
  "circle.manage":                [Y, Y, N, N, N, N],
  "members.view":                 [Y, Y, Y, Y, Y, N],
  "members.manage":               [Y, Y, N, N, N, N],
  "consent.manage":               [Y, N, N, N, N, N],
  "medication.view":              [Y, Y, Y, Y, Y, N],
  "medication.manage":            [Y, Y, N, N, Y, N],
  "dose.record":                  [Y, Y, Y, Y, N, N],
  "appointment.view":             [Y, Y, Y, Y, Y, N],
  "appointment.manage":           [Y, Y, Y, N, Y, N],
  "task.view":                    [Y, Y, Y, Y, N, N],
  "task.manage":                  [Y, Y, Y, N, N, N],
  "task.complete":                [Y, Y, Y, Y, N, N],
  "visit.record":                 [N, Y, Y, Y, N, N],
  "update.view":                  [Y, Y, Y, Y, Y, N],
  "update.post":                  [Y, Y, Y, Y, Y, N],
  "health.view":                  [Y, Y, Y, Y, Y, N],
  "emergency.view":               [Y, Y, Y, Y, Y, Y],
  "emergency.raise":              [Y, Y, Y, Y, N, Y],
  "audit.view":                   [Y, Y, N, N, N, N],
};

describe("permission matrix (self-managing recipient, everything shared)", () => {
  for (const capability of CAPABILITIES) {
    CIRCLE_ROLES.forEach((role, i) => {
      it(`${role} ${EXPECTED[capability][i] ? "can" : "cannot"} ${capability}`, () => {
        expect(can(member(role), profile(), capability)).toBe(EXPECTED[capability][i]);
      });
    });
  }
});

describe("care recipient autonomy", () => {
  it("a self-managing recipient controls consent; admins cannot override it", () => {
    expect(can(member("care_recipient"), profile(true), "consent.manage")).toBe(true);
    expect(can(member("admin"), profile(true), "consent.manage")).toBe(false);
    expect(can(member("admin", true), profile(true), "consent.manage")).toBe(false);
  });

  it("when not self-managing, admins and the legal representative manage consent instead", () => {
    expect(can(member("care_recipient"), profile(false), "consent.manage")).toBe(false);
    expect(can(member("admin"), profile(false), "consent.manage")).toBe(true);
    expect(can(member("family", true), profile(false), "consent.manage")).toBe(true);
    expect(can(member("family"), profile(false), "consent.manage")).toBe(false);
  });

  it("a recipient who is not self-managing keeps their own view but loses circle management", () => {
    const p = profile(false);
    expect(can(member("care_recipient"), p, "circle.manage")).toBe(false);
    expect(can(member("care_recipient"), p, "members.manage")).toBe(false);
    expect(can(member("care_recipient"), p, "medication.view")).toBe(true);
    expect(can(member("care_recipient"), p, "emergency.raise")).toBe(true);
  });
});

describe("consent restrictions", () => {
  it("withholding medications hides them from family and admins but not from caregivers or clinicians", () => {
    const p = profile(true, { shareMedications: false });
    for (const cap of ["medication.view", "dose.record"] as const) {
      expect(can(member("family"), p, cap)).toBe(false);
      expect(can(member("admin"), p, cap)).toBe(false);
    }
    expect(can(member("admin"), p, "medication.manage")).toBe(false);
    expect(can(member("caregiver"), p, "medication.view")).toBe(true);
    expect(can(member("clinician"), p, "medication.view")).toBe(true);
    expect(can(member("care_recipient"), p, "medication.view")).toBe(true);
  });

  it("withholding appointments and health records works independently", () => {
    const p = profile(true, { shareAppointments: false, shareHealth: false });
    expect(can(member("family"), p, "appointment.view")).toBe(false);
    expect(can(member("family"), p, "appointment.manage")).toBe(false);
    expect(can(member("family"), p, "health.view")).toBe(false);
    expect(can(member("family"), p, "medication.view")).toBe(true);
    expect(can(member("family"), p, "task.view")).toBe(true);
  });

  it("emergency information stays available regardless of sharing choices", () => {
    const p = profile(true, { shareMedications: false, shareAppointments: false, shareHealth: false });
    for (const role of CIRCLE_ROLES) expect(can(member(role), p, "emergency.view")).toBe(true);
  });
});

describe("emergency contacts get minimal access", () => {
  it("can see the circle and emergency info and raise/acknowledge alerts, nothing else", () => {
    expect(capabilitiesFor(member("emergency_contact"), profile())).toEqual(["circle.view", "emergency.view", "emergency.raise"]);
  });
});

describe("hasManager", () => {
  it("is satisfied by an active admin", () => {
    expect(hasManager([{ role: "admin", active: true }], { selfManaging: false })).toBe(true);
  });

  it("is satisfied by a self-managing recipient alone", () => {
    expect(hasManager([{ role: "care_recipient", active: true }], { selfManaging: true })).toBe(true);
    expect(hasManager([{ role: "care_recipient", active: true }], { selfManaging: false })).toBe(false);
  });

  it("ignores inactive members and non-managing roles", () => {
    expect(
      hasManager(
        [
          { role: "admin", active: false },
          { role: "family", active: true },
        ],
        { selfManaging: true },
      ),
    ).toBe(false);
  });
});
