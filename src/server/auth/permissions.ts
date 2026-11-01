// The CareNest permission model as a pure function. See docs/PLAN.md §4 for the matrix.
// Kept free of I/O so it can be tested exhaustively and reused by services and UI.

export const CIRCLE_ROLES = ["care_recipient", "admin", "family", "caregiver", "clinician", "emergency_contact"] as const;
export type CircleRole = (typeof CIRCLE_ROLES)[number];

export const CAPABILITIES = [
  "circle.view",
  "circle.manage",
  "members.view",
  "members.manage",
  "consent.manage",
  "medication.view",
  "medication.manage",
  "dose.record",
  "appointment.view",
  "appointment.manage",
  "task.view",
  "task.manage",
  "task.complete",
  "visit.record",
  "update.view",
  "update.post",
  "health.view",
  "measurement.record",
  "document.upload",
  "emergency.view",
  "emergency.raise",
  "audit.view",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** What the care recipient (or, if they are not self-managing, their admin/representative) shares with family. */
export type Consent = {
  shareMedications: boolean;
  shareAppointments: boolean;
  shareHealth: boolean;
};

export const DEFAULT_CONSENT: Consent = { shareMedications: true, shareAppointments: true, shareHealth: true };

export type MemberContext = { role: CircleRole; isLegalRepresentative: boolean };
export type ProfileContext = { selfManaging: boolean; consent: Consent };

type Rule = boolean | ((m: MemberContext, p: ProfileContext) => boolean);

const familyOrAdmin = (m: MemberContext) => m.role === "family" || m.role === "admin";
/** ◐ in the matrix: family and admins see this category only while the recipient shares it. */
const shared = (key: keyof Consent) => (m: MemberContext, p: ProfileContext) => !familyOrAdmin(m) || p.consent[key];
const recipientIfSelfManaging = (m: MemberContext, p: ProfileContext) => m.role === "care_recipient" && p.selfManaging;

type Matrix = Record<Capability, Partial<Record<CircleRole, Rule>>>;

const MATRIX: Matrix = {
  "circle.view": { care_recipient: true, admin: true, family: true, caregiver: true, clinician: true, emergency_contact: true },
  "circle.manage": { care_recipient: recipientIfSelfManaging, admin: true },
  "members.view": { care_recipient: true, admin: true, family: true, caregiver: true, clinician: true },
  "members.manage": { care_recipient: recipientIfSelfManaging, admin: true },
  // A self-managing recipient alone decides what is shared. Otherwise an admin or the legal
  // representative does (handled in `can` because it depends on the representative flag).
  "consent.manage": { care_recipient: recipientIfSelfManaging, admin: (_m, p) => !p.selfManaging },
  "medication.view": {
    care_recipient: true,
    admin: shared("shareMedications"),
    family: shared("shareMedications"),
    caregiver: true,
    clinician: true,
  },
  "medication.manage": { care_recipient: true, admin: shared("shareMedications"), clinician: true },
  "dose.record": {
    care_recipient: true,
    admin: shared("shareMedications"),
    family: shared("shareMedications"),
    caregiver: true,
  },
  "appointment.view": {
    care_recipient: true,
    admin: shared("shareAppointments"),
    family: shared("shareAppointments"),
    caregiver: true,
    clinician: true,
  },
  "appointment.manage": {
    care_recipient: true,
    admin: shared("shareAppointments"),
    family: shared("shareAppointments"),
    clinician: true,
  },
  "task.view": { care_recipient: true, admin: true, family: true, caregiver: true },
  "task.manage": { care_recipient: true, admin: true, family: true },
  "task.complete": { care_recipient: true, admin: true, family: true, caregiver: true },
  "visit.record": { admin: true, family: true, caregiver: true },
  "update.view": { care_recipient: true, admin: true, family: true, caregiver: true, clinician: true },
  "update.post": { care_recipient: true, admin: true, family: true, caregiver: true, clinician: true },
  "health.view": {
    care_recipient: true,
    admin: shared("shareHealth"),
    family: shared("shareHealth"),
    caregiver: true,
    clinician: true,
  },
  /** Readings such as blood pressure are health details: family and admins record them only while shared. */
  "measurement.record": {
    care_recipient: true,
    admin: shared("shareHealth"),
    family: shared("shareHealth"),
    caregiver: true,
    clinician: true,
  },
  /** Documents are health details: family and admins add them only while health details are shared. */
  "document.upload": {
    care_recipient: true,
    admin: shared("shareHealth"),
    family: shared("shareHealth"),
    caregiver: true,
    clinician: true,
  },
  "emergency.view": { care_recipient: true, admin: true, family: true, caregiver: true, clinician: true, emergency_contact: true },
  "emergency.raise": { care_recipient: true, admin: true, family: true, caregiver: true, emergency_contact: true },
  "audit.view": { care_recipient: true, admin: true },
};

export function can(member: MemberContext, profile: ProfileContext, capability: Capability): boolean {
  if (capability === "consent.manage" && !profile.selfManaging && member.isLegalRepresentative) return true;
  const rule = MATRIX[capability][member.role];
  if (rule === undefined) return false;
  return typeof rule === "function" ? rule(member, profile) : rule;
}

export function capabilitiesFor(member: MemberContext, profile: ProfileContext): Capability[] {
  return CAPABILITIES.filter((c) => can(member, profile, c));
}

/**
 * A circle must always have someone able to manage it: an active admin, or a self-managing
 * care recipient. Used to block removing/demoting the last manager.
 */
export function hasManager(
  members: { role: CircleRole; active: boolean }[],
  profile: Pick<ProfileContext, "selfManaging">,
): boolean {
  return members.some((m) => m.active && (m.role === "admin" || (m.role === "care_recipient" && profile.selfManaging)));
}
