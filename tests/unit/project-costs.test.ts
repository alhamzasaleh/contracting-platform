import { describe, expect, it } from "vitest";
import { projectCostRows, type ProjectCostInput } from "@/lib/purchases";

/** Two projects (and a general-stock movement) sharing purchases, subcontractors, petty cash and repairs. */
function sample(vatRegistered: boolean): ProjectCostInput {
  return {
    contracts: [
      { id: "c1", number: "C-2026-001", client_id: "k1", status: "accepted" },
      { id: "c2", number: "C-2026-002", client_id: "k2", status: "accepted" },
    ],
    clients: [
      { id: "k1", name: "أبو محمد" },
      { id: "k2", name: "فيلا الياسمين" },
    ],
    moves: [
      { contract_id: "c1", quantity: 10, unit_cost: 12.5 },
      { contract_id: "c1", quantity: -2, unit_cost: 12.5 }, // returned to stock
      { contract_id: "c2", quantity: 4, unit_cost: "33.335" },
      { contract_id: null, quantity: 50, unit_cost: 3 },
    ],
    purchases: [
      { id: "p1", contract_id: "c1", status: "recorded", total: 115, subtotal: 100 },
      { id: "p2", contract_id: "c2", status: "recorded", total: 230, subtotal: 200 },
      { id: "p3", contract_id: "c2", status: "pending_approval", total: 999, subtotal: 868.7 },
      { id: "p4", contract_id: "c1", status: "pending_approval", total: 50, subtotal: 50 },
    ],
    expenseLines: [
      { purchase_id: "p1", amount: 40 },
      { purchase_id: "p2", amount: 60 },
      { purchase_id: "p2", amount: 15.5 },
    ],
    agreements: [
      { id: "g1", contract_id: "c1" },
      { id: "g2", contract_id: "c2" },
    ],
    subWork: [
      { agreement_id: "g1", amount: 1000 },
      { agreement_id: "g2", amount: 250 },
      { agreement_id: "g2", amount: 250 },
    ],
    petty: [
      { contract_id: "c1", amount: 75 },
      { contract_id: "c2", amount: 20 },
    ],
    repairs: [{ contract_id: "c2", cost: 300 }],
    labour: [
      { contract_id: "c1", labour: 1800 },
      { contract_id: "c2", labour: "600.004" },
    ],
    estimates: new Map([
      ["c1", 500],
      ["c2", 1200],
    ]),
    vatRegistered,
  };
}

/** What the database returns when loadProjectCosts(session, id) filters every query to one project. */
function onlyProject(d: ProjectCostInput, id: string): ProjectCostInput {
  const agreements = d.agreements.filter((g) => g.contract_id === id);
  const purchases = d.purchases.filter((p) => p.contract_id === id);
  return {
    ...d,
    contracts: d.contracts.filter((c) => c.id === id),
    moves: d.moves.filter((m) => m.contract_id === id),
    purchases,
    expenseLines: d.expenseLines.filter((l) => purchases.some((p) => p.id === l.purchase_id)),
    agreements,
    subWork: d.subWork.filter((w) => agreements.some((g) => g.id === w.agreement_id)),
    petty: d.petty.filter((e) => e.contract_id === id),
    repairs: d.repairs.filter((m) => m.contract_id === id),
  };
}

describe("project costs: one project vs the full list", () => {
  for (const vat of [true, false]) {
    it(`a project's figures are the same loaded alone or with every project (VAT number: ${vat})`, () => {
      const all = projectCostRows(sample(vat));
      for (const id of ["c1", "c2"]) {
        const one = projectCostRows(onlyProject(sample(vat), id));
        expect(one).toEqual([all.find((r) => r.id === id)]);
      }
    });
  }

  it("adds up materials, expenses, petty cash, subcontractors, covered repairs and labour", () => {
    const [c1, c2] = projectCostRows(sample(false));
    // c1: stock 8 × 12.5 = 100; expense 40 × 1.15 (VAT is a cost without a VAT number) = 46; petty 75
    expect(c1).toMatchObject({ client: "أبو محمد", materials: 100, expenses: 46, petty: 75, materialsActual: 221, subcontractors: 1000, labour: 1800, maintenance: 0, pending: 50, estimated: 500 });
    expect(c1.actual).toBe(221 + 1000 + 1800);
    // c2: 4 × 33.335 = 133.34; expenses (60 + 15.5) × 1.15 = 86.825 → 86.83; repairs 300 covered by the warranty
    expect(c2).toMatchObject({ materials: 133.34, expenses: 86.83, subcontractors: 500, maintenance: 300, labour: 600, pending: 999 });
    // with a VAT number the purchase VAT is reclaimed
    expect(projectCostRows(sample(true))[0].expenses).toBe(40);
  });

  it("labour stays hidden (null) when the viewer can't see salaries", () => {
    const rows = projectCostRows({ ...sample(true), labour: null });
    expect(rows.map((r) => r.labour)).toEqual([null, null]);
    expect(rows[0].actual).toBe(100 + 40 + 75 + 1000);
  });
});
