import type { Capability, CircleRole } from "@/server/auth/permissions";

export const ALERT_KINDS = ["doseReminders", "unconfirmedDoses", "refills", "appointments", "tasks"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** What a person must be able to see in the circle for an alert kind to apply to them. */
export const ALERT_CAPABILITY: Record<AlertKind, Capability> = {
  doseReminders: "medication.view",
  unconfirmedDoses: "medication.view",
  refills: "medication.view",
  appointments: "appointment.view",
  tasks: "task.view",
};

/**
 * Sensible defaults so a new circle works without configuration: the person taking the medicine
 * and their caregiver get reminders; family and caregivers hear about unconfirmed doses; the
 * people who usually buy medicine hear about low stock; the parent hears about their own
 * appointments and organisers about missing drivers and unclaimed or overdue tasks.
 * Everyone can change their own choices.
 *
 * Alerts about something a person has taken on themselves (a task assigned to them, an
 * appointment they're driving to or going along to) always reach them and aren't listed here.
 */
export const ROLE_ALERT_DEFAULTS: Record<CircleRole, Record<AlertKind, boolean>> = {
  care_recipient: { doseReminders: true, unconfirmedDoses: false, refills: false, appointments: true, tasks: false },
  admin: { doseReminders: false, unconfirmedDoses: true, refills: true, appointments: true, tasks: true },
  family: { doseReminders: false, unconfirmedDoses: true, refills: true, appointments: true, tasks: true },
  caregiver: { doseReminders: true, unconfirmedDoses: true, refills: true, appointments: false, tasks: false },
  clinician: { doseReminders: false, unconfirmedDoses: false, refills: false, appointments: false, tasks: false },
  emergency_contact: { doseReminders: false, unconfirmedDoses: false, refills: false, appointments: false, tasks: false },
};

/**
 * Roles that the worker sends each kind of optional alert to at all. A choice is only offered to
 * these roles: a switch that could never make a difference would be misleading.
 */
const ROLES_RECEIVING: Record<AlertKind, readonly CircleRole[]> = {
  doseReminders: ["care_recipient", "admin", "family", "caregiver", "clinician", "emergency_contact"],
  unconfirmedDoses: ["care_recipient", "admin", "family", "caregiver", "clinician", "emergency_contact"],
  refills: ["care_recipient", "admin", "family", "caregiver", "clinician", "emergency_contact"],
  appointments: ["care_recipient", "admin", "family"],
  tasks: ["admin", "family"],
};

export function offersChoice(role: CircleRole, kind: AlertKind): boolean {
  return ROLES_RECEIVING[kind].includes(role);
}

export type AlertOverrides = {
  notifyDoseReminders: boolean | null;
  notifyUnconfirmedDoses: boolean | null;
  notifyRefills: boolean | null;
  notifyAppointments: boolean | null;
  notifyTasks: boolean | null;
};

const COLUMN: Record<AlertKind, keyof AlertOverrides> = {
  doseReminders: "notifyDoseReminders",
  unconfirmedDoses: "notifyUnconfirmedDoses",
  refills: "notifyRefills",
  appointments: "notifyAppointments",
  tasks: "notifyTasks",
};

export function wantsAlert(role: CircleRole, overrides: AlertOverrides, kind: AlertKind): boolean {
  return overrides[COLUMN[kind]] ?? ROLE_ALERT_DEFAULTS[role][kind];
}

export function effectiveAlertSettings(role: CircleRole, overrides: AlertOverrides): Record<AlertKind, boolean> {
  return Object.fromEntries(ALERT_KINDS.map((k) => [k, wantsAlert(role, overrides, k)])) as Record<AlertKind, boolean>;
}

export function alertColumn(kind: AlertKind): keyof AlertOverrides {
  return COLUMN[kind];
}
