import { DateTime } from "luxon";

/**
 * <input type="datetime-local"> has no time zone. CareNest interprets what people type in the
 * care recipient's zone ("10:00 Amma's time"), not the viewer's — a sibling abroad entering a
 * hospital appointment must get the hospital's local time.
 */
export function zonedInputToIso(local: string, timeZone: string): string | null {
  if (!local) return null;
  const dt = DateTime.fromISO(local, { zone: timeZone });
  return dt.isValid ? dt.toUTC().toISO() : null;
}

/** The reverse, for pre-filling an input with an existing instant. */
export function isoToZonedInput(value: Date | string | null, timeZone: string): string {
  if (!value) return "";
  return DateTime.fromJSDate(new Date(value), { zone: timeZone }).toFormat("yyyy-LL-dd'T'HH:mm");
}
