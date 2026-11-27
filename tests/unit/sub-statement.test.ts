import { describe, expect, it } from "vitest";
import { subStatement, subTotals } from "@/lib/subcontractors/statement";

const ag = [
  { id: "a", contract: "C-2026-001", client: "أبو فهد", scope: "أسقف" },
  { id: "b", contract: "C-2026-002", client: "مؤسسة", scope: "قواطع" },
];

describe("subcontractor statement", () => {
  it("work and payments by date (work before a payment on the same day), running balance = earned − paid", () => {
    const s = subStatement(
      ag,
      [{ agreement_id: "a", work_date: "2026-11-01", quantity_m2: 50, percent: null, amount: 1000, note: null }, { agreement_id: "b", work_date: "2026-11-10", quantity_m2: null, percent: 50, amount: 2000, note: "نص" }],
      [{ agreement_id: "a", number: "SP-2026-001", paid_on: "2026-11-10", amount: 800, method: "transfer" }, { agreement_id: "x", number: "SP-2026-009", paid_on: "2026-11-11", amount: 9, method: "cash" }],
    );
    expect(s.rows.map((r) => [r.date, r.kind, r.balance])).toEqual([["2026-11-01", "work", 1000], ["2026-11-10", "work", 3000], ["2026-11-10", "payment", 2200]]);
    expect(s.totals).toEqual({ earned: 3000, paid: 800, balance: 2200 });
    // another subcontractor's payment (unknown agreement) is never in his statement
    expect(s.rows.some((r) => r.voucher === "SP-2026-009")).toBe(false);
  });

  it("totals over all his projects", () => {
    expect(subTotals([
      { basis: "per_m2", rate: 20, quantity_m2: 100, work: [{ amount: 1000 }], payments: [{ amount: 800 }] },
      { basis: "lump", rate: 5000, quantity_m2: null, work: [{ amount: 2500 }], payments: [] },
    ])).toEqual({ agreed: 7000, earned: 3500, paid: 800, due: 2700, projects: 2 });
  });
});
