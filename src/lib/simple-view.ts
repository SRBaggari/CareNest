// Pure helpers for the Simple view (the parent's own screen). Kept free of React and I/O so the
// rules that decide what an older person sees can be tested directly.

import { DateTime } from "luxon";
import type { DoseStatus } from "@/server/domain/doses";

/** How far ahead a dose can be confirmed (matches the server's early-recording window). */
export const CONFIRM_EARLY_MINUTES = 120;

export type SimpleDose = {
  id: string;
  status: DoseStatus;
  scheduledFor: Date | string | null;
  occurredAt: Date | string | null;
  medication: { name: string; dosage: string; instructions: string | null; status: string };
};

export type DoseGroups<T extends SimpleDose> = {
  /** Due now or overdue and not answered: ask "Did you take it?". */
  now: T[];
  /** Later today; confirm buttons appear once within the early window. */
  later: T[];
  /** Already answered today. */
  done: T[];
};

const ANSWERED: DoseStatus[] = ["taken", "administered", "skipped", "refused"];

export function groupDoses<T extends SimpleDose>(doses: T[], now: Date): DoseGroups<T> {
  const groups: DoseGroups<T> = { now: [], later: [], done: [] };
  for (const d of doses) {
    if (d.medication.status !== "active" && !ANSWERED.includes(d.status)) continue;
    if (ANSWERED.includes(d.status)) groups.done.push(d);
    else if (d.scheduledFor && new Date(d.scheduledFor).getTime() - now.getTime() > CONFIRM_EARLY_MINUTES * 60_000) groups.later.push(d);
    else groups.now.push(d);
  }
  return groups;
}

export type Greeting = "morning" | "afternoon" | "evening";

/** Greeting for the person's own local time. */
export function greetingFor(now: Date, timeZone: string): Greeting {
  const hour = DateTime.fromJSDate(now, { zone: timeZone }).hour;
  if (hour >= 4 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

export type DayLabel = "today" | "tomorrow" | "later";

/** "Today" / "Tomorrow" in the person's zone; anything further is "later" (shown with a date). */
export function dayLabel(at: Date | string, now: Date, timeZone: string): DayLabel {
  const day = DateTime.fromJSDate(new Date(at), { zone: timeZone }).startOf("day");
  const today = DateTime.fromJSDate(now, { zone: timeZone }).startOf("day");
  const diff = Math.round(day.diff(today, "days").days);
  if (diff <= 0) return "today";
  if (diff === 1) return "tomorrow";
  return "later";
}

/** A clock time that reads naturally in the person's language, e.g. "8:00 am" / "ఉ. 8:00". */
export function clockTime(at: Date | string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(at));
}

/**
 * Where a signed-in person should land: their Simple view if they are the person receiving care
 * in an active circle and haven't chosen the full app on this device; otherwise null (full app).
 */
export function simpleViewTarget(
  circles: { id: string; role: string; status: string }[],
  viewPreference: string | undefined,
): string | null {
  if (viewPreference === "full") return null;
  const own = circles.find((c) => c.role === "care_recipient" && c.status === "active");
  return own ? `/simple/${own.id}` : null;
}
