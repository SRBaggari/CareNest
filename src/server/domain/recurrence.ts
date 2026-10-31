import { DateTime } from "luxon";

export type Recurrence = "none" | "daily" | "weekly" | "monthly";

/**
 * Next due time for a recurring task, keeping the recipient's wall-clock time across DST and
 * month lengths (31 Jan + 1 month = 28/29 Feb). If occurrences were missed, it skips ahead to the
 * first one after `now` instead of creating a backlog of overdue copies.
 */
export function nextOccurrence(dueAt: Date, recurrence: Recurrence, timeZone: string, now: Date): Date | null {
  if (recurrence === "none") return null;
  const step = recurrence === "daily" ? { days: 1 } : recurrence === "weekly" ? { weeks: 1 } : { months: 1 };
  const start = DateTime.fromJSDate(dueAt, { zone: timeZone });
  let n = 1;
  let next = start.plus({ days: (step.days ?? 0) * n, weeks: (step.weeks ?? 0) * n, months: (step.months ?? 0) * n });
  while (next.toJSDate().getTime() <= now.getTime()) {
    n++;
    next = start.plus({ days: (step.days ?? 0) * n, weeks: (step.weeks ?? 0) * n, months: (step.months ?? 0) * n });
  }
  return next.toJSDate();
}
