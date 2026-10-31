import type { DoseStatus } from "@/server/domain/doses";

export type DisplayStatus = "upcoming" | "scheduled" | "reminded" | Exclude<DoseStatus, "scheduled">;
export type Tone = "success" | "warning" | "neutral" | "info";

/** What to show for a dose. Statuses are always shown as words plus a symbol, never colour alone. */
export function displayStatus(
  dose: { status: DoseStatus; scheduledFor: Date | string | null; reminderSentAt: Date | string | null },
  now: Date,
): DisplayStatus {
  if (dose.status !== "scheduled") return dose.status;
  if (dose.reminderSentAt) return "reminded";
  if (dose.scheduledFor && new Date(dose.scheduledFor).getTime() > now.getTime()) return "upcoming";
  return "scheduled";
}

export const STATUS_TONE: Record<DisplayStatus, Tone> = {
  upcoming: "neutral",
  scheduled: "info",
  reminded: "info",
  unconfirmed: "warning",
  taken: "success",
  administered: "success",
  skipped: "neutral",
  refused: "warning",
};

export const STATUS_SYMBOL: Record<DisplayStatus, string> = {
  upcoming: "○",
  scheduled: "●",
  reminded: "●",
  unconfirmed: "?",
  taken: "✓",
  administered: "✓",
  skipped: "–",
  refused: "✕",
};

/** "08:00" in a zone and locale. */
export function formatClock(value: Date | string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(value));
}
