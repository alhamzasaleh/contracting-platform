import { describe, expect, it } from "vitest";
import { agreementTotal, pettyBalance, subSummary, workAmount } from "@/lib/subcontractors";

describe("subcontractors", () => {
  const m2 = { basis: "per_m2" as const, rate: 15, quantity_m2: 400 };
  const lump = { basis: "lump" as const, rate: 8000, quantity_m2: null };

  it("agreed totals", () => {
    expect(agreementTotal(m2)).toBe(6000);
    expect(agreementTotal(lump)).toBe(8000);
  });

  it("work entries earn by area or share", () => {
    expect(workAmount(m2, { quantity_m2: 120 })).toBe(1800);
    expect(workAmount(lump, { percent: 25 })).toBe(2000);
  });

  it("due, remaining and warnings (no retention)", () => {
    expect(subSummary(m2, 1800, 1500)).toMatchObject({ due: 300, remaining: 4500, overpaid: false, progress: 30 });
    expect(subSummary(m2, 1800, 2000)).toMatchObject({ due: 0, overpaid: true });
    expect(subSummary(m2, 6300, 0).overEarned).toBe(true);
  });

  it("petty cash balance", () => {
    expect(pettyBalance([{ kind: "topup", amount: 1000 }, { kind: "expense", amount: 85 }, { kind: "return", amount: 100 }])).toBe(815);
    expect(pettyBalance([{ kind: "expense", amount: 50 }])).toBe(-50);
  });
});
