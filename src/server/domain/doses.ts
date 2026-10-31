// Dose status rules. Pure functions shared by services, UI and tests.

import type { CircleRole } from "@/server/auth/permissions";

export const DOSE_STATUSES = ["scheduled", "unconfirmed", "taken", "administered", "skipped", "refused"] as const;
export type DoseStatus = (typeof DOSE_STATUSES)[number];

/** Statuses a person can record. "scheduled" and "unconfirmed" are set only by the system. */
export const RECORDABLE_STATUSES = ["taken", "administered", "skipped", "refused"] as const;
export type RecordableStatus = (typeof RECORDABLE_STATUSES)[number];

export type DoseSource = "self" | "proxy" | "caregiver";

/** Default time after the scheduled moment before an unanswered dose is shown as unconfirmed. */
export const DEFAULT_GRACE_MINUTES = 60;
/** Doses can be confirmed a little early (people take morning pills before 08:00), not hours ahead. */
export const MAX_EARLY_RECORDING_MINUTES = 120;
/** Corrections are allowed for this long after the scheduled time; older history is left as recorded. */
export const CORRECTION_WINDOW_HOURS = 72;

/** Who may record which status: only someone else can "administer" a dose to the recipient. */
export function canRecordStatus(role: CircleRole, status: RecordableStatus): boolean {
  if (status === "administered") return role === "caregiver" || role === "family" || role === "admin";
  return true;
}

/**
 * Where the information came from, shown next to every record:
 * the recipient themselves, a relative reporting on their behalf, or a caregiver giving it.
 */
export function doseSource(role: CircleRole, status: RecordableStatus): DoseSource {
  if (role === "care_recipient") return "self";
  if (role === "caregiver" || status === "administered") return "caregiver";
  return "proxy";
}

/** A scheduled dose with no answer after the grace period is "unconfirmed" — never assumed missed or taken. */
export function isOverdue(scheduledFor: Date, now: Date, graceMinutes = DEFAULT_GRACE_MINUTES): boolean {
  return now.getTime() > scheduledFor.getTime() + graceMinutes * 60_000;
}

export function consumesSupply(status: DoseStatus): boolean {
  return status === "taken" || status === "administered";
}

/** Change in stock when a dose moves between statuses (negative = used, positive = given back on correction). */
export function supplyDelta(previous: DoseStatus, next: DoseStatus, unitsPerDose: number): number {
  return (consumesSupply(previous) ? unitsPerDose : 0) - (consumesSupply(next) ? unitsPerDose : 0);
}

export function needsRefill(supplyCount: number | null, refillThreshold: number | null): boolean {
  return supplyCount !== null && refillThreshold !== null && supplyCount <= refillThreshold;
}

/** Roughly how many days of supply remain, given scheduled doses per day; null if unknown. */
export function daysOfSupply(supplyCount: number | null, dosesPerDay: number, unitsPerDose: number): number | null {
  if (supplyCount === null || dosesPerDay <= 0 || unitsPerDose <= 0) return null;
  return Math.floor(supplyCount / (dosesPerDay * unitsPerDose));
}
