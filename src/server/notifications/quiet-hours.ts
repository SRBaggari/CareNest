import { DateTime } from "luxon";

/**
 * Quiet hours are written in the user's own zone and may cross midnight ("22:00"–"07:00").
 * Returns when the current quiet period ends, or null if it is not quiet time now.
 */
export function quietUntil(now: Date, timeZone: string, start: string | null, end: string | null): Date | null {
  if (!start || !end || start === end) return null;
  const local = DateTime.fromJSDate(now, { zone: timeZone });
  const minutes = local.hour * 60 + local.minute;
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const s = toMinutes(start);
  const e = toMinutes(end);
  const crossesMidnight = s > e;
  const quiet = crossesMidnight ? minutes >= s || minutes < e : minutes >= s && minutes < e;
  if (!quiet) return null;

  const [eh, em] = end.split(":").map(Number);
  let endAt = local.set({ hour: eh, minute: em, second: 0, millisecond: 0 });
  if (endAt <= local) endAt = endAt.plus({ days: 1 });
  return endAt.toJSDate();
}
