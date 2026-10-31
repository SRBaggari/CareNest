// Medication schedule expansion. Pure functions: no I/O, `now` passed in.
//
// Schedules are written in the care recipient's own wall-clock time ("08:00 and 20:00") and
// anchored to their IANA zone, so a dose stays at 08:00 for them even when relatives abroad
// change their clocks. Instants are computed with Luxon so DST transitions are handled.

import { DateTime } from "luxon";

export const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type ScheduleSpec = {
  /** Wall-clock times "HH:MM" in the recipient's zone. Empty for as-needed medicines. */
  times: string[];
  /** ISO weekdays (1 = Monday … 7 = Sunday), or null for every day. */
  daysOfWeek: number[] | null;
  /** Inclusive local dates "YYYY-MM-DD". */
  startDate: string;
  endDate: string | null;
  asNeeded: boolean;
};

export type Occurrence = {
  scheduledFor: Date;
  localDate: string;
  /** The time as written in the schedule. */
  localTime: string;
  /**
   * True when the written time does not exist that day (spring-forward DST gap) and the dose
   * was moved to the first valid minute after it. Shown to the family so nobody is confused.
   */
  shifted: boolean;
};

/** The recipient's current local calendar date. */
export function localDateIn(timeZone: string, now: Date): string {
  return DateTime.fromJSDate(now, { zone: timeZone }).toISODate()!;
}

/** [start, end) instants of a local calendar day; days can be 23 or 25 hours around DST. */
export function localDayBounds(localDate: string, timeZone: string): { start: Date; end: Date } {
  const start = DateTime.fromISO(localDate, { zone: timeZone }).startOf("day");
  return { start: start.toJSDate(), end: start.plus({ days: 1 }).toJSDate() };
}

export function addDays(localDate: string, days: number): string {
  return DateTime.fromISO(localDate, { zone: "UTC" }).plus({ days }).toISODate()!;
}

/** Converts a local date + "HH:MM" to an instant, moving non-existent (DST gap) times forward. */
export function localToInstant(localDate: string, localTime: string, timeZone: string): { instant: Date; shifted: boolean } {
  const [hour, minute] = localTime.split(":").map(Number);
  const [year, month, day] = localDate.split("-").map(Number);
  const dt = DateTime.fromObject({ year, month, day, hour, minute }, { zone: timeZone });
  // Luxon moves a time inside a spring-forward gap past it; detect that by comparing the clock.
  const shifted = dt.hour !== hour || dt.minute !== minute;
  return { instant: dt.toJSDate(), shifted };
}

/**
 * All scheduled doses whose local date falls within [fromDate, toDate] (inclusive), in time
 * order. As-needed medicines have no scheduled doses.
 */
export function expandSchedule(spec: ScheduleSpec, timeZone: string, fromDate: string, toDate: string): Occurrence[] {
  if (spec.asNeeded || spec.times.length === 0) return [];
  const first = fromDate > spec.startDate ? fromDate : spec.startDate;
  const last = spec.endDate && spec.endDate < toDate ? spec.endDate : toDate;
  if (first > last) return [];

  const times = [...new Set(spec.times)].sort();
  const days = spec.daysOfWeek ? new Set(spec.daysOfWeek) : null;
  const out: Occurrence[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    const weekday = DateTime.fromISO(date, { zone: "UTC" }).weekday;
    if (days && !days.has(weekday)) continue;
    for (const time of times) {
      const { instant, shifted } = localToInstant(date, time, timeZone);
      out.push({ scheduledFor: instant, localDate: date, localTime: time, shifted });
    }
  }
  return out.sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
}
