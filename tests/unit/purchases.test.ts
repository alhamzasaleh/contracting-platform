import { describe, expect, it } from "vitest";
import { costStatus, invoiceFlags, purchaseTotals, stockBalances, type InvoiceDraft } from "@/lib/purchases";

const draft = (over: Partial<InvoiceDraft> = {}): InvoiceDraft => ({
  supplier_name: "مؤسسة التوريد",
  supplier_vat: "300000000000003",
  invoice_number: "INV-55",
  invoice_date: "2026-11-20",
  lines: [
    { description: "لوح جبس", quantity: 100, unit: "pcs", unit_price: 22, amount: 2200 },
    { description: "مسامير", quantity: 2, unit: "box", unit_price: 35, amount: 70 },
  ],
  subtotal: 2270,
  vat: 340.5,
  total: 2610.5,
  unclear_fields: [],
  ...over,
});

describe("purchases", () => {
  it("totals lines and VAT", () => {
    expect(purchaseTotals([{ kind: "material", quantity: 3, unit_price: 19.99 }, { kind: "expense", quantity: 1, unit_price: 150 }], 31.5)).toEqual({ subtotal: 209.97, vat: 31.5, total: 241.47 });
  });

  it("a clean invoice raises no flags", () => {
    expect(invoiceFlags(draft())).toEqual([]);
  });

  it("flags what needs a second look", () => {
    expect(invoiceFlags(draft({ subtotal: 2300, total: 2640.5 }))).toContain("linesVsSubtotal");
    expect(invoiceFlags(draft({ total: 9999 }))).toContain("totalMismatch");
    expect(invoiceFlags(draft({ vat: 100, total: 2370 }))).toContain("vatNot15");
    expect(invoiceFlags(draft({ supplier_vat: "12345" }))).toContain("supplierVatInvalid");
    expect(invoiceFlags(draft({ invoice_date: null }))).toContain("dateMissing");
    expect(invoiceFlags(draft({ lines: [], subtotal: null }))).toContain("noLines");
  });

  it("estimated vs actual levels", () => {
    expect(costStatus(1000, 500).level).toBe("ok");
    expect(costStatus(1000, 950).level).toBe("watch");
    expect(costStatus(1000, 1100)).toEqual({ ratio: 1.1, level: "over" });
    expect(costStatus(null, 100).level).toBe("none");
  });

  it("balances per location at cost", () => {
    const b = stockBalances([
      { item_id: "i", contract_id: null, quantity: 100, unit_cost: 20 },
      { item_id: "i", contract_id: null, quantity: -40, unit_cost: 20 },
      { item_id: "i", contract_id: "k", quantity: 40, unit_cost: 20 },
      { item_id: "j", contract_id: "k", quantity: 5, unit_cost: 10 },
      { item_id: "j", contract_id: "k", quantity: -5, unit_cost: 10 },
    ]);
    expect(b).toEqual([
      { item_id: "i", contract_id: null, quantity: 60, value: 1200 },
      { item_id: "i", contract_id: "k", quantity: 40, value: 800 },
    ]);
  });
});
