import type { CircleRole } from "@/server/auth/permissions";

export const ALERT_KINDS = ["doseReminders", "unconfirmedDoses", "refills"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/**
 * Sensible defaults so a new circle works without configuration: the person taking the medicine
 * and their caregiver get reminders; family and caregivers hear about unconfirmed doses; the
 * people who usually buy medicine hear about low stock. Everyone can change their own choices.
 */
export const ROLE_ALERT_DEFAULTS: Record<CircleRole, Record<AlertKind, boolean>> = {
  care_recipient: { doseReminders: true, unconfirmedDoses: false, refills: false },
  admin: { doseReminders: false, unconfirmedDoses: true, refills: true },
  family: { doseReminders: false, unconfirmedDoses: true, refills: true },
  caregiver: { doseReminders: true, unconfirmedDoses: true, refills: true },
  clinician: { doseReminders: false, unconfirmedDoses: false, refills: false },
  emergency_contact: { doseReminders: false, unconfirmedDoses: false, refills: false },
};

export type AlertOverrides = {
  notifyDoseReminders: boolean | null;
  notifyUnconfirmedDoses: boolean | null;
  notifyRefills: boolean | null;
};

const COLUMN: Record<AlertKind, keyof AlertOverrides> = {
  doseReminders: "notifyDoseReminders",
  unconfirmedDoses: "notifyUnconfirmedDoses",
  refills: "notifyRefills",
};

export function wantsAlert(role: CircleRole, overrides: AlertOverrides, kind: AlertKind): boolean {
  return overrides[COLUMN[kind]] ?? ROLE_ALERT_DEFAULTS[role][kind];
}

export function effectiveAlertSettings(role: CircleRole, overrides: AlertOverrides): Record<AlertKind, boolean> {
  return {
    doseReminders: wantsAlert(role, overrides, "doseReminders"),
    unconfirmedDoses: wantsAlert(role, overrides, "unconfirmedDoses"),
    refills: wantsAlert(role, overrides, "refills"),
  };
}

export function alertColumn(kind: AlertKind): keyof AlertOverrides {
  return COLUMN[kind];
}
