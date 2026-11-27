import { describe, expect, it } from "vitest";
import { canMeasure, measureDiff, measurableTypes, measurementError, measurementTotals, r2, toBasis } from "@/lib/measurements";

const basis = toBasis({
  method: "unit", discount_percent: 10, vat_percent: 15,
  work_types: [{ workType: "ceilings", area: 100, pricePerM2: 50 }, { workType: "partitions", area: 40, pricePerM2: 70 }],
})!;

describe("measurements (mirror of the database rule)", () => {
  it("prices the difference at the contract price per m², discount % then VAT — same numbers as tests/db/measurements", () => {
    const d = measureDiff(basis, [{ workType: "ceilings", measured: 110 }, { workType: "partitions", measured: 38 }]);
    expect(d.lines.map((l) => [l.work_type, l.diff_area, l.diff_amount])).toEqual([["ceilings", 10, 500], ["partitions", -2, -140]]);
    expect([d.subtotal, d.vat, d.total]).toEqual([324, 48.6, 372.6]);
    expect(measureDiff(basis, [{ workType: "ceilings", measured: 90 }]).total).toBe(-517.5);
    expect(measureDiff(basis, [{ workType: "walls", measured: 9 }]).lines).toEqual([]);
  });

  it("rounds like Postgres (half away from zero, also below zero)", () => {
    expect(r2(1.005)).toBe(1.01);
    expect(r2(-1.005)).toBe(-1.01);
    expect(r2(-0.004)).toBe(0);
  });

  it("each work type is measured once; lump sum can't be measured", () => {
    expect(measurableTypes(basis, [{ id: "a", lines: [{ work_type: "ceilings" } as never] }])).toEqual(["partitions"]);
    expect(measurableTypes(basis, [{ id: "a", lines: [{ work_type: "ceilings" } as never] }], "a")).toEqual(["ceilings", "partitions"]);
    expect(canMeasure(basis)).toBe(true);
    expect(canMeasure(toBasis({ method: "lump", work_types: [{ workType: "x", area: 1, pricePerM2: 1 }] }))).toBe(false);
    expect(canMeasure(null)).toBe(false);
  });

  it("totals only what the client approved; owed = credit not yet refunded", () => {
    const t = measurementTotals([
      { status: "approved", diff_subtotal: 324, diff_total: 372.6, credit_amount: 0, refunded_at: null },
      { status: "approved", diff_subtotal: -90, diff_total: -103.5, credit_amount: 103.5, refunded_at: null },
      { status: "approved", diff_subtotal: -10, diff_total: -11.5, credit_amount: 11.5, refunded_at: "2026-11-20" },
      { status: "sent", diff_subtotal: 999, diff_total: 999, credit_amount: 0, refunded_at: null },
    ]);
    expect(t).toEqual({ net: 224, total: 257.6, owed: 103.5 });
  });

  it("maps database refusals", () => {
    expect(measurementError("lump sum contract")).toBe("measureLump");
    expect(measurementError("work type already measured")).toBe("measureTaken");
    expect(measurementError("measurement pending")).toBe("measurePending");
    expect(measurementError("a sent measurement can't change")).toBe("measureLocked");
    expect(measurementError("boom")).toBe("error");
  });
});

describe("credit notes (review)", () => {
  it("Qoyod credit note: tax-inclusive like its invoice, CN number as reference; allocation to the invoice", async () => {
    const { creditNoteBody, creditAllocationBody, waitsForApproved } = await import("@/lib/qoyod/payloads");
    const b = creditNoteBody({ contactId: 3, reference: "CN-2026-001", issueDate: "2026-11-24", status: "Draft", inventoryId: 1, productId: 9, description: "MS-2026-003 — تسوية الأمتار", gross: 517.5, vatPercent: 15 });
    expect(b.credit_note.reference).toBe("CN-2026-001");
    expect(b.credit_note.line_items).toEqual([{ product_id: 9, description: "MS-2026-003 — تسوية الأمتار", quantity: 1, unit_price: 517.5, tax_percent: 15, is_inclusive: true }]);
    expect(creditNoteBody({ contactId: 3, reference: "x", issueDate: "d", status: "Draft", inventoryId: 1, productId: 9, description: "d", gross: 10, vatPercent: 0 }).credit_note.line_items[0].tax_percent).toBe(0);
    expect(creditAllocationBody({ creditNoteId: 8, amount: 103.5, date: "2026-11-24" })).toEqual({ invoice: { allocations_attributes: [{ source_type: "CreditNote", source_id: 8, amount: "103.50", date: "2026-11-24" }] } });
    // the allocation waits for Approved (a draft invoice can't take it); the credit note itself doesn't
    expect(waitsForApproved("credit_allocation", "Draft")).toBe(true);
    expect(waitsForApproved("credit_note", "Draft")).toBe(false);
  });

  it("an invoice's remaining part excludes what credit notes took off it", async () => {
    const { invoicePaid, invoiceRemaining, invoiceStatus } = await import("@/lib/invoices");
    // 9000 invoiced, 103.50 credited, the rest paid → paid shows 8896.50, nothing remaining
    const paid = invoicePaid(9000, { amount: 8896.5, full: true }, 103.5);
    expect(paid).toBe(8896.5);
    expect(invoiceRemaining({ total: 9000, paid, credited: 103.5 })).toBe(0);
    expect(invoiceStatus({ total: 9000, paid, credited: 103.5, due_date: "2026-01-01" }, "2026-11-24")).toBe("paid");
    expect(invoiceRemaining({ total: 9000, paid: 4000, credited: 103.5 })).toBe(4896.5);
  });
});

describe("credit allocation is never sent twice (review)", () => {
  it("finds an earlier allocation of the credit note in the invoice answer", async () => {
    const { allocationExists } = await import("@/lib/qoyod/payloads");
    expect(allocationExists({ invoice: { id: 3, allocations: [{ source_type: "CreditNote", source_id: 8, amount: "103.5" }] } }, 8)).toBe(true);
    expect(allocationExists({ invoice: { id: 3, allocations: [{ source_type: "Receipt", source_id: 8 }] } }, 8)).toBe(false);
    expect(allocationExists({ invoice: { id: 3, allocations: [{ source_type: "CreditNote", source_id: 9 }] } }, 8)).toBe(false);
    expect(allocationExists(null, 8)).toBe(false);
  });
});
