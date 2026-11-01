import { describe, expect, it } from "vitest";
import { balances, checkCustomSplit, defaultCurrency, FORMER_MEMBER, MAX_AMOUNT_MINOR, minorToDecimal, parseAmount, settleUp, splitEqually } from "./expenses";

describe("amounts", () => {
  it("reads rupees and paise exactly, with or without commas", () => {
    expect(parseAmount("1200")).toBe(120000);
    expect(parseAmount("1,200.5")).toBe(120050);
    expect(parseAmount("0.10")).toBe(10);
    expect(parseAmount(" 99.99 ")).toBe(9999);
    expect(parseAmount(1200.5)).toBe(120050);
  });

  it("refuses zero, negatives, three decimals, words and huge typos", () => {
    for (const bad of ["0", "-5", "1.005", "abc", "", "1e3", String(MAX_AMOUNT_MINOR / 100 + 1)]) expect([bad, parseAmount(bad)]).toEqual([bad, null]);
  });

  it("formats minor units back to a plain decimal", () => {
    expect(minorToDecimal(120050)).toBe("1200.50");
    expect(minorToDecimal(5)).toBe("0.05");
    expect(minorToDecimal(-250)).toBe("-2.50");
  });

  it("defaults to the parent's country's currency", () => {
    expect(defaultCurrency("IN")).toBe("INR");
    expect(defaultCurrency("GB")).toBe("GBP");
    expect(defaultCurrency("ZZ")).toBe("INR");
  });
});

describe("splitting", () => {
  it("splits equally, and the payer absorbs the leftover paisa so the total always matches", () => {
    const shares = splitEqually(10000, ["ravi", "priya", "anil"], "priya");
    expect(shares).toEqual([
      { memberId: "priya", amountMinor: 3334 },
      { memberId: "ravi", amountMinor: 3333 },
      { memberId: "anil", amountMinor: 3333 },
    ]);
    expect(shares.reduce((s, x) => s + x.amountMinor, 0)).toBe(10000);
  });

  it("works when the payer isn't sharing the cost, and ignores duplicates", () => {
    expect(splitEqually(1001, ["ravi", "anil", "ravi"], "priya")).toEqual([
      { memberId: "ravi", amountMinor: 501 },
      { memberId: "anil", amountMinor: 500 },
    ]);
  });

  it("checks a custom split covers the total exactly", () => {
    expect(checkCustomSplit(1000, [{ memberId: "a", amountMinor: 600 }, { memberId: "b", amountMinor: 400 }])).toBeNull();
    expect(checkCustomSplit(1000, [{ memberId: "a", amountMinor: 600 }])).toMatch(/add up/);
    expect(checkCustomSplit(1000, [{ memberId: "a", amountMinor: 1000 }, { memberId: "b", amountMinor: 0 }])).toMatch(/more than zero/);
    expect(checkCustomSplit(1000, [{ memberId: "a", amountMinor: 500 }, { memberId: "a", amountMinor: 500 }])).toMatch(/only once/);
    expect(checkCustomSplit(1000, [])).toMatch(/Choose/);
  });
});

describe("balances and settling up", () => {
  const exp = (paidBy: string | null, amountMinor: number, shares: [string | null, number][], currency = "INR") => ({
    paidBy,
    amountMinor,
    currency,
    shares: shares.map(([memberId, a]) => ({ memberId, amountMinor: a })),
  });

  it("works out who owes whom, and settling up brings everyone to zero", () => {
    const ledger = {
      expenses: [exp("priya", 3000, [["priya", 1000], ["ravi", 1000], ["anil", 1000]]), exp("ravi", 600, [["ravi", 300], ["anil", 300]])],
      settlements: [],
    };
    const inr = balances(ledger).get("INR")!;
    expect(Object.fromEntries(inr)).toEqual({ priya: 2000, ravi: -700, anil: -1300 });
    const transfers = settleUp(inr);
    expect(transfers).toEqual([
      { from: "anil", to: "priya", amountMinor: 1300 },
      { from: "ravi", to: "priya", amountMinor: 700 },
    ]);
    const settled = balances({ ...ledger, settlements: transfers.map((t) => ({ fromMember: t.from, toMember: t.to, amountMinor: t.amountMinor, currency: "INR" })) });
    expect(settled.size).toBe(0);
  });

  it("never converts between currencies", () => {
    const b = balances({ expenses: [exp("priya", 5000, [["ravi", 5000]], "GBP"), exp("ravi", 100000, [["priya", 100000]])], settlements: [] });
    expect(Object.fromEntries(b.get("GBP")!)).toEqual({ priya: 5000, ravi: -5000 });
    expect(Object.fromEntries(b.get("INR")!)).toEqual({ ravi: 100000, priya: -100000 });
  });

  it("groups a deleted account as a former member, who is never asked to pay or paid", () => {
    const inr = balances({ expenses: [exp(null, 2000, [["ravi", 1000], [null, 1000]]), exp("priya", 1000, [["ravi", 1000]])], settlements: [] }).get("INR")!;
    expect(Object.fromEntries(inr)).toEqual({ [FORMER_MEMBER]: 1000, ravi: -2000, priya: 1000 });
    expect(settleUp(inr)).toEqual([{ from: "ravi", to: "priya", amountMinor: 1000 }]);
  });

  it("is the same list for everyone, whatever order things were recorded in", () => {
    const a = settleUp(new Map([["x", 500], ["y", 500], ["z", -1000]]));
    const b = settleUp(new Map([["z", -1000], ["y", 500], ["x", 500]]));
    expect(a).toEqual(b);
  });
});
