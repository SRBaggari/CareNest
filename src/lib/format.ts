/** Formats an instant in a given IANA zone and locale, e.g. "14 Nov 2026, 08:00". */
export function formatDateTime(value: Date | string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value));
}

export function formatDate(value: Date | string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(new Date(value));
}

/** Weekday and wall-clock time in a zone, labelled with the zone, e.g. "Sat 08:00 IST". */
export function formatLocalTime(value: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(value);
}
