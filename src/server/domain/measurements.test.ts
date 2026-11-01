import { describe, expect, it } from "vitest";
import { chartValue, checkReading, formatReading } from "./measurements";

describe("checkReading", () => {
  it("stores readings in one unit per kind, accepting the units families use", () => {
    expect(checkReading("temperature", "°F", 101.3, null)).toEqual({ ok: true, value: expect.closeTo(38.5, 1), value2: null });
    expect(checkReading("blood_sugar", "mmol/L", 7, null)).toEqual({ ok: true, value: expect.closeTo(126.1, 1), value2: null });
    expect(checkReading("weight", "lb", 132, null)).toEqual({ ok: true, value: expect.closeTo(59.9, 1), value2: null });
    expect(checkReading("blood_pressure", "mmHg", 128, 82)).toEqual({ ok: true, value: 128, value2: 82 });
  });

  it("catches typing mistakes, and says what's expected in the unit used", () => {
    const fever = checkReading("temperature", "°F", 1013, null);
    expect(fever.ok).toBe(false);
    if (!fever.ok) expect(fever.errors.value?.[0]).toContain("°F");
    expect(checkReading("weight", "kg", 7, null).ok).toBe(false);
    expect(checkReading("oxygen", "%", 101, null).ok).toBe(false);
    expect(checkReading("pulse", "bpm", Number.NaN, null).ok).toBe(false);
  });

  it("needs both blood-pressure numbers, the higher one first", () => {
    expect(checkReading("blood_pressure", "mmHg", 128, null)).toMatchObject({ ok: false, errors: { value2: [expect.any(String)] } });
    expect(checkReading("blood_pressure", "mmHg", 82, 128)).toMatchObject({ ok: false, errors: { value2: [expect.stringContaining("order")] } });
    expect(checkReading("pulse", "bpm", 72, 60)).toMatchObject({ ok: false, errors: { value2: [expect.any(String)] } });
  });

  it("rejects units that don't belong to the kind", () => {
    expect(checkReading("weight", "°C", 60, null)).toMatchObject({ ok: false, errors: { unit: [expect.stringContaining("kg, lb")] } });
  });

  it("never judges a plausible reading: a very high blood pressure is still recorded", () => {
    expect(checkReading("blood_pressure", "mmHg", 210, 120).ok).toBe(true);
    expect(checkReading("blood_sugar", "mg/dL", 450, null).ok).toBe(true);
  });
});

describe("formatReading and chartValue", () => {
  it("shows a reading in the unit it was entered in", () => {
    const stored = checkReading("temperature", "°F", 101.3, null);
    if (!stored.ok) throw new Error("expected ok");
    expect(formatReading("temperature", "°F", stored.value, null, "en")).toBe("101.3 °F");
    expect(formatReading("blood_pressure", "mmHg", 128, 82, "en")).toBe("128/82 mmHg");
    expect(formatReading("oxygen", "%", 97, null, "en")).toBe("97%");
    expect(chartValue("temperature", "°F", stored.value)).toBe(101.3);
  });
});
