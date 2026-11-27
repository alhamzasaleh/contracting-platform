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
