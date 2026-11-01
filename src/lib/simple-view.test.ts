import { describe, expect, it } from "vitest";
import { clockTime, dayLabel, greetingFor, groupDoses, simpleViewTarget, type SimpleDose } from "./simple-view";

const now = new Date("2026-11-14T04:00:00Z"); // 09:30 in Kolkata
const med = { name: "Metformin", dosage: "500 mg", instructions: null, status: "active" };
const dose = (id: string, status: SimpleDose["status"], at: string | null, medication = med): SimpleDose => ({
  id,
  status,
  scheduledFor: at,
  occurredAt: null,
  medication,
});

describe("groupDoses", () => {
  it("asks about due and overdue doses now, shows later ones as later, and answered ones as done", () => {
    const g = groupDoses(
      [
        dose("overdue", "unconfirmed", "2026-11-14T02:30:00Z"), // 08:00, not answered
        dose("due", "scheduled", "2026-11-14T04:00:00Z"), // 09:30, now
        dose("soon", "scheduled", "2026-11-14T05:30:00Z"), // 11:00, within 2 h: can confirm
        dose("evening", "scheduled", "2026-11-14T14:30:00Z"), // 20:00
        dose("taken", "taken", "2026-11-14T01:30:00Z"),
        dose("refused", "refused", "2026-11-14T00:30:00Z"),
        dose("prn", "administered", null),
      ],
      now,
    );
    expect(g.now.map((d) => d.id)).toEqual(["overdue", "due", "soon"]);
    expect(g.later.map((d) => d.id)).toEqual(["evening"]);
    expect(g.done.map((d) => d.id)).toEqual(["taken", "refused", "prn"]);
  });

  it("never asks about a medicine that has been stopped, but keeps what was already recorded", () => {
    const stopped = { ...med, status: "stopped" };
    const g = groupDoses([dose("a", "unconfirmed", "2026-11-14T02:30:00Z", stopped), dose("b", "taken", "2026-11-14T01:00:00Z", stopped)], now);
    expect(g.now).toEqual([]);
    expect(g.done.map((d) => d.id)).toEqual(["b"]);
  });
});

describe("greetingFor", () => {
  it("uses the person's own local time", () => {
    expect(greetingFor(now, "Asia/Kolkata")).toBe("morning"); // 09:30
    expect(greetingFor(now, "America/Chicago")).toBe("evening"); // 22:00 the day before
    expect(greetingFor(new Date("2026-11-14T09:00:00Z"), "Asia/Kolkata")).toBe("afternoon"); // 14:30
  });
});

describe("dayLabel", () => {
  it("says today / tomorrow in the person's zone", () => {
    expect(dayLabel("2026-11-14T12:00:00Z", now, "Asia/Kolkata")).toBe("today");
    expect(dayLabel("2026-11-15T04:30:00Z", now, "Asia/Kolkata")).toBe("tomorrow");
    expect(dayLabel("2026-11-17T04:30:00Z", now, "Asia/Kolkata")).toBe("later");
    // 23:30 IST on the 14th is still "today" even though it is the 15th nowhere near Kolkata.
    expect(dayLabel("2026-11-14T18:00:00Z", now, "Asia/Kolkata")).toBe("today");
  });
});

describe("clockTime", () => {
  it("formats in the person's zone and language", () => {
    expect(clockTime("2026-11-14T02:30:00Z", "en-IN", "Asia/Kolkata")).toMatch(/^8:00\s?am$/i);
    expect(clockTime("2026-11-14T14:30:00Z", "en-GB", "Asia/Kolkata")).toBe("20:00");
  });
});

describe("simpleViewTarget", () => {
  const own = { id: "c1", role: "care_recipient", status: "active" };
  it("sends the person receiving care to their Simple view by default", () => {
    expect(simpleViewTarget([own], undefined)).toBe("/simple/c1");
    expect(simpleViewTarget([{ id: "c0", role: "family", status: "active" }, own], "simple")).toBe("/simple/c1");
  });

  it("respects choosing the full app, and never applies to family, caregivers or archived circles", () => {
    expect(simpleViewTarget([own], "full")).toBeNull();
    expect(simpleViewTarget([{ id: "c2", role: "family", status: "active" }], undefined)).toBeNull();
    expect(simpleViewTarget([{ ...own, status: "archived" }], undefined)).toBeNull();
  });
});
