// Turns the "Today" summary into plain sentences and links for the family and caregiver dashboard.
// Pure: the page passes a time formatter so tests don't depend on the server's locale or zone.
import type { AttentionItem } from "@/server/services/today";

export type AttentionEntry = {
  href: string;
  /** Message key under "today." */
  key: string;
  vars: Record<string, string | number>;
  /** An open request for help is shown differently from everything else. */
  urgent: boolean;
};

export function attentionEntry(item: AttentionItem, circleId: string, time: (d: Date) => string): AttentionEntry {
  const base = `/app/circles/${circleId}`;
  switch (item.kind) {
    case "open_help_request":
      return { href: `${base}/emergency/${item.requestId}`, key: "attnHelp", vars: { time: time(item.raisedAt) }, urgent: true };
    case "dose_unconfirmed":
      return { href: `${base}/medicines`, key: "attnDoses", vars: { count: item.count }, urgent: false };
    case "needs_driver":
      return { href: `${base}/appointments`, key: "attnDriver", vars: { title: item.title, time: time(item.startsAt) }, urgent: false };
    case "visit_not_checked_in":
      return { href: `${base}/visits`, key: "attnVisit", vars: { name: item.visitor ?? "—", time: time(item.plannedStart) }, urgent: false };
    case "low_stock":
      return { href: `${base}/medicines`, key: "attnStock", vars: { name: item.name, count: item.supplyCount }, urgent: false };
    case "overdue_task":
      return { href: `${base}/tasks`, key: "attnOverdue", vars: { count: item.count }, urgent: false };
    case "unassigned_task":
      return { href: `${base}/tasks`, key: "attnUnassigned", vars: { count: item.count }, urgent: false };
  }
}

export type DoseCounts = Record<"upcoming" | "due" | "taken" | "administered" | "skipped" | "refused" | "unconfirmed", number>;

/** Today's doses as a short tally, most pressing first, leaving out what didn't happen. */
export function doseTally(counts: DoseCounts): { key: string; count: number }[] {
  const order = [
    ["unconfirmed", counts.unconfirmed],
    ["due", counts.due],
    ["taken", counts.taken + counts.administered],
    ["skipped", counts.skipped + counts.refused],
    ["upcoming", counts.upcoming],
  ] as const;
  return order.filter(([, n]) => n > 0).map(([key, count]) => ({ key: `dose_${key}`, count }));
}
