import { describe, expect, it } from "vitest";
import { SAFE_LINK } from "@/lib/assistant/context";
import { payrollFlows } from "@/lib/finance";
import { defaultSelection, EMPTY_QUANTITIES, priceSelection, stepIncluded, STEPS, type PricingContext } from "@/lib/pricing";
import { linesFromPurchaseList } from "@/lib/purchases";
import { pickDefaults } from "@/lib/qoyod/defaults";
import { invoiceBody, pettyBillRef, simpleBillBody, subcontractorBillRef } from "@/lib/qoyod/payloads";
import { buildSnapshot, readiness, type PurchaseItem } from "@/lib/quotes";
import { bookingTeam } from "@/lib/schedule";
import { seededProducts, seededRates } from "./helpers/seed";

const ctx: PricingContext = { catalogue: { products: seededProducts(), rates: seededRates() }, external: [], crew: [], vatPercent: 15 };

describe("#13 Qoyod invoices total exactly what the client owes", () => {
  it("sends the VAT-inclusive amount as a tax-inclusive line (no rounding drift), for many amounts", () => {
    for (let cents = 1; cents < 200_000; cents += 37) {
      const gross = cents / 100;
      const body = invoiceBody({ contactId: 1, reference: "INV-2026-001", description: "x", issueDate: "2026-11-01", dueDate: "2026-11-01", status: "Draft", inventoryId: 1, productId: 2, lineDescription: "x", gross, vatPercent: 15 });
      const line = body.invoice.line_items[0];
      expect(line).toMatchObject({ unit_price: gross, tax_percent: 15, is_inclusive: true, quantity: 1 });
    }
  });
  it("without VAT the amount goes as it is, not tax-inclusive", () => {
    const line = invoiceBody({ contactId: 1, reference: "r", description: "x", issueDate: "2026-11-01", dueDate: "2026-11-01", status: "Draft", inventoryId: 1, productId: 2, lineDescription: "x", gross: 1234.56, vatPercent: 0 }).invoice.line_items[0];
    expect(line).toMatchObject({ unit_price: 1234.56, tax_percent: 0 });
    expect("is_inclusive" in line && line.is_inclusive).toBeFalsy();
  });
});

describe("#15 excluded gypsum parts are not promised to the client", () => {
  it("a step whose part the client supplies is not listed as included", () => {
    const sel = { ...defaultSelection("gypsum", ctx.catalogue), excluded: ["joint_compound"] };
    const q = { ...EMPTY_QUANTITIES, ceilNormal: 100 };
    const s = buildSnapshot(sel, q, priceSelection(sel, q, ctx), { discountPercent: 0, method: "unit", estimated: false, vatPercent: 0, catalogue: ctx.catalogue });
    expect(s.clientView.included.map((i) => i.step)).not.toContain("joint_compound");
    expect(s.clientView.excluded).toContain("joint_compound");
    // a multi-part step stays included while some of its parts are ours
    const metal = STEPS.gypsum.find((x) => x.key === "metal")!;
    expect(stepIncluded(metal, sel.steps.metal, ["omega"])).toBe(true);
    expect(stepIncluded(metal, sel.steps.metal, metal.roles)).toBe(false);
  });
});

describe("#16 labour that can't be priced blocks the quote", () => {
  it("an in-house crew without cost, an empty crew or a missing contractor is an unpriced item", () => {
    const q = { ...EMPTY_QUANTITIES, walls: 300, ceilings: 100, colours: 1 };
    const base = defaultSelection("interior", ctx.catalogue);
    for (const labour of [
      { source: "inhouse" as const, crew: [] },
      { source: "external" as const, externalId: "00000000-0000-4000-8000-000000000000" },
    ]) {
      const sel = { ...base, labour };
      const o = priceSelection(sel, q, ctx);
      expect(o.problems.some((p) => p.reason === "labour")).toBe(true);
      const snap = buildSnapshot(sel, q, o, { discountPercent: 0, method: "unit", estimated: false, vatPercent: 0, catalogue: ctx.catalogue });
      expect(readiness(o, snap, 0, []).blocking).toContain("unpriced_items");
    }
    const noCost = priceSelection({ ...base, labour: { source: "inhouse", crew: ["e1"] } }, q, { ...ctx, crew: [{ id: "e1", name: "x", job: null, perDay: null }] });
    expect(noCost.problems.some((p) => p.reason === "labour")).toBe(true);
    // template rates and a supply-only job are fine
    expect(priceSelection(base, q, ctx).problems.some((p) => p.reason === "labour")).toBe(false);
  });
});

describe("#17 assistant links and the payroll forecast", () => {
  it("allows every page the assistant can point to", () => {
    for (const ok of ["/invoices/INV-2026-001", "/clients/CL-2026-003", "/quotations/Q-2026-010", "/purchases/costs", "/maintenance?r=MR-2026-002", "/invoices", "/contracts/C-2026-001"]) expect(SAFE_LINK.test(ok)).toBe(true);
    for (const bad of ["/invoices/../x", "/clients/x?y=1", "/maintenance?r=x", "//evil.example", "/settings/qoyod"]) expect(SAFE_LINK.test(bad)).toBe(false);
  });

  it("uses a month's payroll run net when it exists (nothing once paid), otherwise gross; statutory items every month", () => {
    const flows = payrollFlows(["2026-11-27", "2026-12-27", "2027-01-27"], [{ month: "2026-11", status: "approved", net: 9000 }, { month: "2026-12", status: "paid", net: 9100 }], 10000, 1200);
    expect(flows.map((f) => [f.date, f.label, f.amount])).toEqual([
      ["2026-11-27", "salaries", 9000],
      ["2026-11-27", "statutory", 1200],
      ["2026-12-27", "statutory", 1200],
      ["2027-01-27", "salaries", 10000],
      ["2027-01-27", "statutory", 1200],
    ]);
  });
});

describe("G1 the team chosen when pricing is booked in the schedule", () => {
  const teams = [{ id: "t-in", subcontractor_id: null }, { id: "t-sub", subcontractor_id: "s1" }];
  it("in-house: the team picked; external: the subcontractor's team", () => {
    expect(bookingTeam({ source: "inhouse", crew: ["e1"], teamId: "t-in" }, [], teams)).toBe("t-in");
    expect(bookingTeam({ source: "inhouse", crew: ["e1"] }, [], teams)).toBeNull();
    expect(bookingTeam({ source: "external", externalId: "r1" }, [{ id: "r1", subcontractor_id: "s1" }], teams)).toBe("t-sub");
    expect(bookingTeam({ source: "external", externalId: "r2" }, [{ id: "r2", subcontractor_id: null }], teams)).toBeNull();
    expect(bookingTeam({ source: "inhouse", crew: [], teamId: "gone" }, [], teams)).toBeNull();
    expect(bookingTeam(null, [], teams)).toBeNull();
  });
});

describe("G2/G3 a purchase from the quote's purchase list", () => {
  const list: PurchaseItem[] = [
    { key: "wall_finish_1", label: "دهان جدران", brand: "Jotun", colour: "أبيض", packs: [{ size: 18, count: 2 }, { size: 4, count: 1 }], qty: 40, unit: "L", leftover: 1, cost: 400, productId: "p-paint" },
    { key: "c_channel", label: "قناة C", brand: "Knauf", colour: null, packs: [{ size: 3, count: 10 }], qty: 28, unit: "m", leftover: null, cost: 110, productId: "p-c" },
    { key: "hatches", label: "فتحات صيانة", brand: null, colour: null, packs: [], qty: 4, unit: "pcs", leftover: null, cost: 300 },
  ];
  it("one line per pack size with the quoted price as a suggestion, product kept, colours stay on the project", () => {
    const rows = linesFromPurchaseList(list, [{ id: "item-c", name: "قناة C 3م", unit: "bar", product_id: "p-c" }]);
    expect(rows.map((r) => [r.description, r.quantity, r.unit, r.unit_price, r.item, r.product_id, r.general, r.colour])).toEqual([
      ["دهان جدران — Jotun (18)", 2, "pack", 180, "new", "p-paint", false, "أبيض"],
      ["دهان جدران — Jotun (4)", 1, "pack", 40, "new", "p-paint", false, "أبيض"],
      ["قناة C — Knauf (3)", 10, "bar", 11, "item-c", "p-c", true, ""],
      ["فتحات صيانة", 4, "pcs", 75, "new", null, true, ""],
    ]);
    // the suggested prices add up to the quoted cost
    expect(rows.reduce((s, r) => s + r.quantity * r.unit_price, 0)).toBeCloseTo(810, 2);
  });
});

describe("G4 subcontractor payments and petty cash in Qoyod", () => {
  it("readable, unique references; a simple bill without VAT", () => {
    expect(subcontractorBillRef("3f2a9c1e-5b7d-4e8a-9c0d-112233445566")).toBe("SUB-3F2A9C1E5B7D");
    expect(pettyBillRef("3f2a9c1e-5b7d-4e8a-9c0d-112233445566")).toBe("PC-3F2A9C1E5B7D");
    const b = simpleBillBody({ contactId: 5, reference: "SUB-1", issueDate: "2026-11-02", status: "Draft", inventoryId: 1, expenseAccountId: 55, description: "x", subtotal: 1500, vat: 0, total: 1500 });
    expect(b.simple_bill.simple_bill_items_attributes[0]).toMatchObject({ expense_category_id: 55, total_amount: 1500, tax_id: "2" });
  });
  it("picks a subcontracting account only on an obvious name", () => {
    const base = { inventories: [], products: [] };
    const acc = (id: number, name: string) => ({ id, code: `5101${id}`, name, receive: false, type: "Expense" });
    expect(pickDefaults({ ...base, accounts: [acc(1, "تكلفة المشتريات"), acc(2, "مقاولي الباطن")] }).subcontractAccountId).toBe(2);
    expect(pickDefaults({ ...base, accounts: [acc(1, "تكلفة المشتريات"), acc(3, "Subcontractors cost")] }).subcontractAccountId).toBe(3);
    expect(pickDefaults({ ...base, accounts: [acc(1, "تكلفة المشتريات")] }).subcontractAccountId).toBeNull();
  });
});
