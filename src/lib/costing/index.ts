/**
 * Costing maths — pure functions shared by the catalogue, HR and (Phase 3)
 * the pricing engine. Money is rounded to 2 decimals only for display.
 */

/** VAT applies only once the company is VAT-registered (has a VAT number). */
export function effectiveVatPercent(vatNumber: string | null | undefined, configuredPercent: number): number {
  return vatNumber && /^3\d{13}3$/.test(vatNumber) ? configuredPercent : 0;
}

export type CostItem = {
  code: string;
  applies_to: "all" | "saudi" | "non_saudi";
  basis: "percent" | "monthly" | "annual" | "one_time";
  value: number;
  amortize_months: number | null;
  is_active: boolean;
};

export type EmployeeCostInput = {
  is_saudi: boolean;
  basic_salary: number;
  housing_allowance: number;
  transport_allowance: number;
  other_allowances: number;
};

export type EmployeeCostBreakdown = {
  salary: number; // basic + all allowances, per month
  statutory: { code: string; monthly: number }[];
  monthlyTotal: number;
  perDay: number;
};

/**
 * Fully loaded monthly cost of an employee and the cost per worker-day.
 * Percent items apply to the contributory wage (basic + housing), as GOSI does.
 */
export function employeeCost(e: EmployeeCostInput, items: CostItem[], workingDaysPerMonth: number): EmployeeCostBreakdown {
  const salary = e.basic_salary + e.housing_allowance + e.transport_allowance + e.other_allowances;
  const contributory = e.basic_salary + e.housing_allowance;
  const statutory = items
    .filter((i) => i.is_active && (i.applies_to === "all" || (i.applies_to === "saudi") === e.is_saudi))
    .map((i) => {
      let monthly = 0;
      if (i.basis === "percent") monthly = (contributory * i.value) / 100;
      else if (i.basis === "monthly") monthly = i.value;
      else if (i.basis === "annual") monthly = i.value / 12;
      else if (i.basis === "one_time") monthly = i.value / Math.max(1, i.amortize_months ?? 12);
      return { code: i.code, monthly };
    })
    .filter((i) => i.monthly > 0);
  const monthlyTotal = salary + statutory.reduce((s, i) => s + i.monthly, 0);
  const days = workingDaysPerMonth > 0 ? workingDaysPerMonth : 26;
  return { salary, statutory, monthlyTotal, perDay: monthlyTotal / days };
}

export type RecipeLine = { qty_per_unit: number | null; waste_percent: number | null; unit_price: number | null };

/**
 * Quantity of a material per service unit (m²).
 * coverage mode: coats ÷ coverage per unit (e.g. 2 coats ÷ 35 m²/gallon).
 * fixed mode: the entered quantity.
 */
export function recipeQtyPerUnit(line: {
  calc_mode: "fixed" | "coverage";
  qty_per_unit: number | null;
  coats: number;
  coverage_per_unit: number | null;
}): number | null {
  if (line.calc_mode === "coverage") {
    return line.coverage_per_unit && line.coverage_per_unit > 0 ? line.coats / line.coverage_per_unit : null;
  }
  return line.qty_per_unit;
}

/** Material cost for one service unit (m²), including waste. Lines without a price are skipped and reported. */
export function materialCostPerUnit(lines: RecipeLine[], defaultWastePercent: number) {
  let total = 0;
  let missingPrices = 0;
  for (const l of lines) {
    if (l.unit_price == null || l.qty_per_unit == null) {
      missingPrices++;
      continue;
    }
    const waste = l.waste_percent ?? defaultWastePercent;
    total += l.qty_per_unit * (1 + waste / 100) * l.unit_price;
  }
  return { total, missingPrices };
}

export type StageInput = { productivity_per_day: number | null; fixed_days: number };

/** Suggested working days for an area with N teams: Σ area/productivity/teams + fixed days. */
export function suggestedDurationDays(area: number, stages: StageInput[], teams = 1) {
  if (area <= 0) return 0;
  const t = Math.max(1, teams);
  const days = stages.reduce((sum, s) => {
    const work = s.productivity_per_day ? area / s.productivity_per_day / t : 0;
    return sum + work + s.fixed_days;
  }, 0);
  return Math.ceil(days * 2) / 2; // half-day steps
}
