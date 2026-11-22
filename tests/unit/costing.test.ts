import { describe, expect, it } from "vitest";
import { effectiveVatPercent, employeeCost, materialCostPerUnit, suggestedDurationDays, type CostItem } from "@/lib/costing";

describe("VAT rule", () => {
  it("is zero until the company has a valid VAT number", () => {
    expect(effectiveVatPercent(null, 15)).toBe(0);
    expect(effectiveVatPercent("", 15)).toBe(0);
    expect(effectiveVatPercent("123", 15)).toBe(0);
    expect(effectiveVatPercent("310000000000003", 15)).toBe(15);
  });
});

const items: CostItem[] = [
  { code: "gosi_saudi", applies_to: "saudi", basis: "percent", value: 12, amortize_months: null, is_active: true },
  { code: "gosi_non_saudi", applies_to: "non_saudi", basis: "percent", value: 2, amortize_months: null, is_active: true },
  { code: "medical", applies_to: "all", basis: "annual", value: 1200, amortize_months: null, is_active: true },
  { code: "levy", applies_to: "non_saudi", basis: "annual", value: 9600, amortize_months: null, is_active: true },
  { code: "recruit", applies_to: "non_saudi", basis: "one_time", value: 4800, amortize_months: 24, is_active: true },
  { code: "off", applies_to: "all", basis: "monthly", value: 999, amortize_months: null, is_active: false },
];

describe("employee cost", () => {
  it("loads a non-Saudi worker with his statutory costs", () => {
    const c = employeeCost({ is_saudi: false, basic_salary: 1500, housing_allowance: 500, transport_allowance: 0, other_allowances: 0 }, items, 26);
    // 2000 salary + 2% of 2000 (40) + 100 medical + 800 levy + 200 recruitment
    expect(c.monthlyTotal).toBeCloseTo(3140, 2);
    expect(c.perDay).toBeCloseTo(3140 / 26, 4);
    expect(c.statutory.map((s) => s.code).sort()).toEqual(["gosi_non_saudi", "levy", "medical", "recruit"]);
  });

  it("applies Saudi-only lines and medical insurance to Saudis", () => {
    const c = employeeCost({ is_saudi: true, basic_salary: 4000, housing_allowance: 1000, transport_allowance: 500, other_allowances: 0 }, items, 26);
    // 5500 + 12% of 5000 (600) + 100 medical
    expect(c.monthlyTotal).toBeCloseTo(6200, 2);
  });
});

describe("material cost per m²", () => {
  it("adds waste and skips missing prices", () => {
    const r = materialCostPerUnit(
      [
        { qty_per_unit: 0.35, waste_percent: 10, unit_price: 23 },
        { qty_per_unit: 2, waste_percent: null, unit_price: 0.5 },
        { qty_per_unit: 1, waste_percent: null, unit_price: null },
      ],
      5,
    );
    expect(r.total).toBeCloseTo(0.35 * 1.1 * 23 + 2 * 1.05 * 0.5, 6);
    expect(r.missingPrices).toBe(1);
  });
});

describe("duration", () => {
  it("sums area/productivity per stage plus fixed days, in half days", () => {
    expect(suggestedDurationDays(420, [{ productivity_per_day: 120, fixed_days: 0 }, { productivity_per_day: 80, fixed_days: 1 }, { productivity_per_day: null, fixed_days: 0.5 }])).toBe(10.5);
    expect(suggestedDurationDays(420, [{ productivity_per_day: 120, fixed_days: 0 }], 2)).toBe(2);
    expect(suggestedDurationDays(0, [{ productivity_per_day: 1, fixed_days: 3 }])).toBe(0);
  });
});
