// Pure rules for reports: which period a report may cover, how doses are tallied, and CSV output.

import { addDays, isValidLocalDate } from "./schedule";

/** Long enough for "since the last visit" (most follow-ups are within three months), short enough to print. */
export const MAX_REPORT_DAYS = 92;
export const DEFAULT_REPORT_DAYS = 30;

export type ReportPeriod = { from: string; to: string };

/** Whole days from `from` to `to`, counting both. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * The period a report covers, in the recipient's local dates. Defaults to the last 30 days ending
 * today; a report never covers the future, never runs backwards and is at most MAX_REPORT_DAYS long.
 */
export function resolvePeriod(input: { from?: string; to?: string }, today: string): { ok: true; period: ReportPeriod } | { ok: false; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  const to = input.to ?? today;
  const from = input.from ?? addDays(to, -(DEFAULT_REPORT_DAYS - 1));
  if (!isValidLocalDate(from)) errors.from = ["Enter a valid date."];
  if (!isValidLocalDate(to)) errors.to = ["Enter a valid date."];
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (to > today) errors.to = ["A report can't include days that haven't happened yet."];
  else if (from > to) errors.from = ["The start must be on or before the end."];
  else if (daysBetween(from, to) > MAX_REPORT_DAYS) errors.from = [`A report can cover at most ${MAX_REPORT_DAYS} days.`];
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, period: { from, to } };
}

export type DoseTally = {
  /** Scheduled doses in the period, whatever happened to them. */
  scheduled: number;
  taken: number;
  administered: number;
  skipped: number;
  refused: number;
  /** Nobody answered the reminder: shown as such, never assumed taken or missed. */
  unconfirmed: number;
  /** Not yet due (or still within the grace period) when the report was made. */
  pending: number;
  /** As-needed doses recorded in the period; they have no schedule to compare against. */
  asNeeded: number;
};

const emptyTally = (): DoseTally => ({ scheduled: 0, taken: 0, administered: 0, skipped: 0, refused: 0, unconfirmed: 0, pending: 0, asNeeded: 0 });

/** Counts doses per medicine. Only facts are reported: no percentages, scores or verdicts. */
export function tallyDoses(rows: { medicationId: string; status: string; scheduled: boolean }[]): Map<string, DoseTally> {
  const out = new Map<string, DoseTally>();
  for (const row of rows) {
    const tally = out.get(row.medicationId) ?? emptyTally();
    out.set(row.medicationId, tally);
    if (!row.scheduled) {
      if (row.status === "taken" || row.status === "administered") tally.asNeeded++;
      continue;
    }
    tally.scheduled++;
    switch (row.status) {
      case "taken":
      case "administered":
      case "skipped":
      case "refused":
      case "unconfirmed":
        tally[row.status]++;
        break;
      default:
        tally.pending++;
    }
  }
  return out;
}

export type CsvCell = string | number | null | undefined;

/**
 * RFC 4180 CSV (CRLF line ends, quotes doubled). Text that a spreadsheet would run as a formula
 * (starting with = + - @, tab or carriage return) is prefixed with an apostrophe so a note like
 * "=HYPERLINK(...)" is shown, never executed. Numbers are written as numbers.
 */
export function toCsv(rows: CsvCell[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}
