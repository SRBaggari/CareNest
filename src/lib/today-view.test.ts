import { describe, expect, it } from "vitest";
import type { AttentionItem } from "@/server/services/today";
import { attentionEntry, doseTally } from "./today-view";

const at = new Date("2026-11-14T04:00:00Z");
const time = (d: Date) => d.toISOString().slice(11, 16);

describe("attentionEntry", () => {
  it("links each kind of attention item to the page where it can be dealt with", () => {
    const cases: [AttentionItem, string, string][] = [
      [{ kind: "dose_unconfirmed", count: 2 }, "/medicines", "attnDoses"],
      [{ kind: "needs_driver", appointmentId: "a", title: "Eye clinic", startsAt: at }, "/appointments", "attnDriver"],
      [{ kind: "unassigned_task", count: 1 }, "/tasks", "attnUnassigned"],
      [{ kind: "overdue_task", count: 3 }, "/tasks", "attnOverdue"],
      [{ kind: "low_stock", medicationId: "m", name: "Metformin", supplyCount: 4 }, "/medicines", "attnStock"],
      [{ kind: "visit_not_checked_in", visitId: "v", visitor: "Priya", plannedStart: at }, "/visits", "attnVisit"],
      [{ kind: "open_help_request", requestId: "r1", status: "open", raisedAt: at }, "/emergency/r1", "attnHelp"],
    ];
    for (const [item, path, key] of cases) {
      const e = attentionEntry(item, "c1", time);
      expect(e.href).toBe(`/app/circles/c1${path}`);
      expect(e.key).toBe(key);
    }
  });

  it("marks only a request for help as urgent", () => {
    expect(attentionEntry({ kind: "open_help_request", requestId: "r", status: "acknowledged", raisedAt: at }, "c", time).urgent).toBe(true);
    expect(attentionEntry({ kind: "overdue_task", count: 1 }, "c", time).urgent).toBe(false);
  });

  it("fills in names, counts and times", () => {
    expect(attentionEntry({ kind: "needs_driver", appointmentId: "a", title: "Eye clinic", startsAt: at }, "c", time).vars).toEqual({ title: "Eye clinic", time: "04:00" });
    expect(attentionEntry({ kind: "low_stock", medicationId: "m", name: "Metformin", supplyCount: 4 }, "c", time).vars).toEqual({ name: "Metformin", count: 4 });
    expect(attentionEntry({ kind: "visit_not_checked_in", visitId: "v", visitor: null, plannedStart: at }, "c", time).vars.name).toBe("—");
  });
});

describe("doseTally", () => {
  const zero = { upcoming: 0, due: 0, taken: 0, administered: 0, skipped: 0, refused: 0, unconfirmed: 0 };

  it("puts unanswered doses first and leaves out empty groups", () => {
    expect(doseTally({ ...zero, upcoming: 2, taken: 1, unconfirmed: 1 })).toEqual([
      { key: "dose_unconfirmed", count: 1 },
      { key: "dose_taken", count: 1 },
      { key: "dose_upcoming", count: 2 },
    ]);
  });

  it("counts given doses as taken and refused ones as not taken", () => {
    expect(doseTally({ ...zero, taken: 1, administered: 2, skipped: 1, refused: 1 })).toEqual([
      { key: "dose_taken", count: 3 },
      { key: "dose_skipped", count: 2 },
    ]);
  });

  it("is empty on a day with no doses", () => {
    expect(doseTally(zero)).toEqual([]);
  });
});
