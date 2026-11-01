// Health readings: what can be recorded, in which units, and what is physically plausible. Pure.
//
// CareNest records and charts readings; it never labels one "high", "low" or "normal". Ranges here
// only catch typing mistakes (a weight of 7 kg, a temperature of 380 °C), not medical judgement.

export const MEASUREMENT_KINDS = ["blood_pressure", "blood_sugar", "weight", "temperature", "pulse", "oxygen"] as const;
export type MeasurementKind = (typeof MEASUREMENT_KINDS)[number];

export const SUGAR_CONTEXTS = ["fasting", "before_meal", "after_meal", "bedtime", "random"] as const;
export type SugarContext = (typeof SUGAR_CONTEXTS)[number];

type Unit = { id: string; toCanonical: (v: number) => number; fromCanonical: (v: number) => number; decimals: number };
type Spec = {
  units: Unit[];
  /** Plausible range, in the canonical (first) unit. */
  range: [number, number];
  /** Blood pressure has a second number (diastolic). */
  range2?: [number, number];
};

const same = (id: string, decimals = 0): Unit => ({ id, toCanonical: (v) => v, fromCanonical: (v) => v, decimals });

export const SPECS: Record<MeasurementKind, Spec> = {
  blood_pressure: { units: [same("mmHg")], range: [60, 260], range2: [30, 160] },
  blood_sugar: {
    units: [same("mg/dL"), { id: "mmol/L", toCanonical: (v) => v * 18.0182, fromCanonical: (v) => v / 18.0182, decimals: 1 }],
    range: [20, 600],
  },
  weight: {
    units: [same("kg", 1), { id: "lb", toCanonical: (v) => v / 2.20462, fromCanonical: (v) => v * 2.20462, decimals: 1 }],
    range: [20, 250],
  },
  temperature: {
    // Many Indian homes have Fahrenheit thermometers, so both are first-class.
    units: [same("°C", 1), { id: "°F", toCanonical: (v) => ((v - 32) * 5) / 9, fromCanonical: (v) => (v * 9) / 5 + 32, decimals: 1 }],
    range: [32, 43.5],
  },
  pulse: { units: [same("bpm")], range: [30, 220] },
  oxygen: { units: [same("%")], range: [50, 100] },
};

export const unitsFor = (kind: MeasurementKind) => SPECS[kind].units.map((u) => u.id);
export const canonicalUnit = (kind: MeasurementKind) => SPECS[kind].units[0].id;

function unitOf(kind: MeasurementKind, unit: string): Unit | undefined {
  return SPECS[kind].units.find((u) => u.id === unit);
}

export type ReadingErrors = Partial<Record<"unit" | "value" | "value2", string[]>>;

/**
 * Checks a reading as typed and returns it in canonical units (what is stored and charted), or the
 * problems found. Messages say what's expected in the unit the person used.
 */
export function checkReading(
  kind: MeasurementKind,
  unit: string,
  value: number,
  value2: number | null,
): { ok: true; value: number; value2: number | null } | { ok: false; errors: ReadingErrors } {
  const spec = SPECS[kind];
  const u = unitOf(kind, unit);
  if (!u) return { ok: false, errors: { unit: [`Use one of: ${unitsFor(kind).join(", ")}.`] } };
  const errors: ReadingErrors = {};
  const canonical = u.toCanonical(value);
  const between = (r: [number, number]) => `between ${round(u.fromCanonical(r[0]), u.decimals)} and ${round(u.fromCanonical(r[1]), u.decimals)} ${unit}`;
  if (!Number.isFinite(value) || canonical < spec.range[0] || canonical > spec.range[1]) {
    errors.value = [`That doesn't look right. Enter a number ${between(spec.range)}.`];
  }
  if (spec.range2) {
    if (value2 === null || !Number.isFinite(value2) || value2 < spec.range2[0] || value2 > spec.range2[1]) {
      errors.value2 = [`Enter the second (lower) number, between ${spec.range2[0]} and ${spec.range2[1]} ${unit}.`];
    } else if (!errors.value && value2 >= value) {
      errors.value2 = ["The second number is usually lower than the first. Check the order."];
    }
  } else if (value2 !== null) {
    errors.value2 = ["This reading has only one number."];
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: canonical, value2: spec.range2 ? value2 : null };
}

function round(v: number, decimals: number) {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** A stored (canonical) reading shown in the unit it was entered in, e.g. "128/82 mmHg" or "101.3 °F". */
export function formatReading(kind: MeasurementKind, unit: string, value: number, value2: number | null, locale: string): string {
  const u = unitOf(kind, unit) ?? SPECS[kind].units[0];
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: u.decimals, minimumFractionDigits: 0 });
  const main = fmt.format(round(u.fromCanonical(value), u.decimals));
  const text = value2 === null ? main : `${main}/${fmt.format(round(value2, u.decimals))}`;
  return u.id === "%" ? `${text}%` : `${text} ${u.id}`;
}

/** The value to plot, in the unit most of this person's readings use, so a chart has one scale. */
export function chartValue(kind: MeasurementKind, unit: string, canonical: number): number {
  const u = unitOf(kind, unit) ?? SPECS[kind].units[0];
  return round(u.fromCanonical(canonical), u.decimals);
}
