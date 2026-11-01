// Pure rules for shared care costs: amounts, splitting, balances and settling up.
// Money is always whole minor units (paise, pence, cents) — never floating point.

/** Currencies families commonly pay care costs in; all have two decimal places. */
export const CURRENCIES = ["INR", "GBP", "USD", "EUR", "AED", "AUD", "CAD", "SGD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const EXPENSE_CATEGORIES = ["medicine", "doctor", "caregiver", "transport", "household", "equipment", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const SPLIT_MODES = ["equal", "custom", "payer_only"] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

/** Large enough for a hospital bill, small enough to catch a typo with extra zeros. */
export const MAX_AMOUNT_MINOR = 100_000_000; // 10 lakh rupees, a million pounds

const COUNTRY_CURRENCY: Record<string, Currency> = { IN: "INR", GB: "GBP", US: "USD", AE: "AED", AU: "AUD", CA: "CAD", SG: "SGD", IE: "EUR", DE: "EUR", FR: "EUR", NL: "EUR" };

export function defaultCurrency(country: string): Currency {
  return COUNTRY_CURRENCY[country] ?? "INR";
}

/** "1200", "1,200.5" or "1200.50" → 120050. Exact: no floating-point arithmetic. Null if not a valid amount. */
export function parseAmount(input: string | number): number | null {
  const text = String(input).trim().replace(/,/g, "");
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  const minor = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  return minor > 0 && minor <= MAX_AMOUNT_MINOR ? minor : null;
}

export type Share = { memberId: string; amountMinor: number };

/**
 * An equal split. Leftover minor units (₹100 three ways) go one each to the participants in the
 * order given, payer first, so the total always matches exactly and the payer absorbs any rounding.
 */
export function splitEqually(amountMinor: number, participantIds: string[], payerId: string): Share[] {
  const ordered = [...new Set(participantIds)].sort((a, b) => (a === payerId ? -1 : b === payerId ? 1 : 0));
  const base = Math.floor(amountMinor / ordered.length);
  const extra = amountMinor - base * ordered.length;
  return ordered.map((memberId, i) => ({ memberId, amountMinor: base + (i < extra ? 1 : 0) }));
}

/** A custom split must cover the whole amount, with each person's part above zero and no one twice. */
export function checkCustomSplit(amountMinor: number, shares: Share[]): string | null {
  if (shares.length === 0) return "Choose who shares this cost.";
  if (new Set(shares.map((s) => s.memberId)).size !== shares.length) return "Each person can appear only once.";
  if (shares.some((s) => !Number.isInteger(s.amountMinor) || s.amountMinor <= 0)) return "Each part must be more than zero.";
  if (shares.reduce((sum, s) => sum + s.amountMinor, 0) !== amountMinor) return "The parts must add up to the total.";
  return null;
}

export type Ledger = {
  expenses: { paidBy: string | null; amountMinor: number; currency: string; shares: { memberId: string | null; amountMinor: number }[] }[];
  settlements: { fromMember: string | null; toMember: string | null; amountMinor: number; currency: string }[];
};

/** A member no longer in the records (their account was deleted) is grouped as one "former member". */
export const FORMER_MEMBER = "former";

/**
 * Each person's position per currency: positive means others owe them, negative means they owe.
 * Currencies are never converted into each other.
 */
export function balances(ledger: Ledger): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const add = (currency: string, member: string | null, delta: number) => {
    const byMember = out.get(currency) ?? new Map<string, number>();
    out.set(currency, byMember);
    const key = member ?? FORMER_MEMBER;
    byMember.set(key, (byMember.get(key) ?? 0) + delta);
  };
  for (const e of ledger.expenses) {
    add(e.currency, e.paidBy, e.amountMinor);
    for (const s of e.shares) add(e.currency, s.memberId, -s.amountMinor);
  }
  for (const s of ledger.settlements) {
    add(s.currency, s.fromMember, s.amountMinor);
    add(s.currency, s.toMember, -s.amountMinor);
  }
  for (const [currency, byMember] of out) {
    for (const [member, amount] of byMember) if (amount === 0) byMember.delete(member);
    if (byMember.size === 0) out.delete(currency);
  }
  return out;
}

export type Transfer = { from: string; to: string; amountMinor: number };

/**
 * Who should pay whom to settle up, in as few payments as this simple method finds: the person who
 * owes most pays the person owed most, repeatedly. Deterministic, so everyone sees the same list.
 * A former member is never asked to pay or paid.
 */
export function settleUp(byMember: Map<string, number>): Transfer[] {
  const people = [...byMember].filter(([m]) => m !== FORMER_MEMBER);
  const sort = (list: [string, number][]) => list.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const owed = sort(people.filter(([, v]) => v > 0).map(([m, v]) => [m, v]));
  const owing = sort(people.filter(([, v]) => v < 0).map(([m, v]) => [m, -v]));
  const transfers: Transfer[] = [];
  while (owed.length > 0 && owing.length > 0) {
    const amount = Math.min(owed[0][1], owing[0][1]);
    transfers.push({ from: owing[0][0], to: owed[0][0], amountMinor: amount });
    owed[0][1] -= amount;
    owing[0][1] -= amount;
    if (owed[0][1] === 0) owed.shift();
    if (owing[0][1] === 0) owing.shift();
    sort(owed);
    sort(owing);
  }
  return transfers;
}

/** 120050 → "1200.50" (for forms and CSV; screens use Intl currency formatting). */
export function minorToDecimal(amountMinor: number): string {
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
