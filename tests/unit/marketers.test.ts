import { describe, expect, it } from "vitest";
import { priceProject, type EngineResult } from "@/lib/engine";
import { defaultSelection, EMPTY_QUANTITIES, priceSelection, type PricingContext } from "@/lib/pricing";
import { buildSnapshot, readiness } from "@/lib/quotes";
import { commissionAmount, commissionPaymentError, commissionTotals, marketerHref, MARKETER_NUMBER_RE } from "@/lib/marketers";
import { seededProducts, seededRates } from "./helpers/seed";

/**
 * Success partners (code: marketers) — the reward (code: commission) rides on the price:
 *   price = cost × (1 + contingency) ÷ (1 − margin − commission)
 * so after paying the reward the margin is still the target; per m² it is rounded UP.
 */
const one = (cost: number, area: number): EngineResult => ({
  lines: [{ key: "x", group: "material", label: "x", need: 1, needUnit: "m2", purchase: { kind: "units", count: 1 }, qty: 1, unit: "m2", unitPrice: cost, cost, formula: "", inputs: {}, workType: "walls" }],
  areas: { walls: area },
  warnings: [],
} as unknown as EngineResult);

describe("price with the partner's reward", () => {
  it("divides by (1 − margin − reward) and keeps the margin after paying it", () => {
    // cost 1000, contingency 5 % → 1050; margin 28 %, reward 5 % → 1050 / 0.67 = 1567.16… → per m² ceil(15.67) = 16 → 1600
    const p = priceProject([one(1000, 100)], { contingencyPercent: 5, marginPercent: 28, roundingStep: 1, method: "unit", vatPercent: 0, commissionPercent: 5 });
    expect(p.byWorkType[0].rawPrice).toBeCloseTo(1050 / 0.67, 6);
    expect(p.byWorkType[0].pricePerM2).toBe(16);
    expect(p.subtotal).toBe(1600);
    expect(p.commissionPercent).toBe(5);
    expect(p.commission).toBe(80);
    // margin after the reward: (1600 − 1050 − 80) / 1600
    expect(p.marginPercent).toBeCloseTo(((1600 - 1050 - 80) / 1600) * 100, 6);
    expect(p.marginPercent).toBeGreaterThanOrEqual(28);
  });

  it("without a partner it is the old formula exactly", () => {
    const a = priceProject([one(1000, 100)], { contingencyPercent: 5, marginPercent: 28, roundingStep: 1, method: "unit", vatPercent: 0 });
    const b = priceProject([one(1000, 100)], { contingencyPercent: 5, marginPercent: 28, roundingStep: 1, method: "unit", vatPercent: 0, commissionPercent: 0 });
    expect(a.subtotal).toBe(b.subtotal);
    expect(a.byWorkType[0].rawPrice).toBeCloseTo(1050 / 0.72, 6);
    expect(a.commission).toBe(0);
  });

  it("lump sum: the rounded total also carries the reward", () => {
    const p = priceProject([one(1000, 0)], { contingencyPercent: 0, marginPercent: 20, roundingStep: 1, method: "lump", vatPercent: 15, commissionPercent: 10 });
    expect(p.subtotal).toBe(Math.ceil(1000 / 0.7));
    expect(p.commission).toBeCloseTo(p.subtotal * 0.1, 2);
  });

  it("never divides by zero or a negative number (margin + reward capped)", () => {
    const p = priceProject([one(1000, 100)], { contingencyPercent: 0, marginPercent: 90, roundingStep: 1, method: "unit", vatPercent: 0, commissionPercent: 50 });
    expect(Number.isFinite(p.subtotal)).toBe(true);
    expect(p.subtotal).toBeGreaterThan(0);
  });
});

describe("quote snapshot with a partner", () => {
  const ctx: PricingContext = { catalogue: { products: seededProducts(), rates: seededRates() }, external: [], crew: [], vatPercent: 15 };
  const q = { ...EMPTY_QUANTITIES, walls: 600, ceilings: 250, colours: 2 };
  const sel = { ...defaultSelection("interior", ctx.catalogue), marginPercent: 28 };
  const plain = priceSelection(sel, q, ctx);
  const withReward = priceSelection(sel, q, ctx, { commissionPercent: 5 });
  const snap = (o: typeof plain, discount = 0, commissionPercent = 0) =>
    buildSnapshot(sel, q, o, { discountPercent: discount, method: "unit", estimated: false, vatPercent: 15, catalogue: ctx.catalogue, commissionPercent });

  it("raises the price, never the cost", () => {
    expect(withReward.price.subtotal).toBeGreaterThan(plain.price.subtotal);
    expect(withReward.price.cost).toBeCloseTo(plain.price.cost, 6);
  });

  it("the client's view never carries the reward", () => {
    const s = snap(withReward, 0, 5);
    expect(JSON.stringify(s.clientView)).not.toMatch(/commission|marketer|reward/i);
    expect(s.commission).toEqual({ percent: 5, amount: Math.round(s.clientView.net * 5) / 100 });
  });

  it("margin is after the reward (on the net after discount), so the minimum-margin check counts it as a cost", () => {
    const s = snap(withReward, 0, 5);
    const expected = ((s.clientView.net - s.costWithContingency - s.commission.amount) / s.clientView.net) * 100;
    expect(s.marginPercent).toBeCloseTo(expected, 1);
    expect(s.marginPercent).toBeGreaterThanOrEqual(28);
    // a 10 % discount: the reward follows the net, the margin drops below 28 → approval
    const d = snap(withReward, 10, 5);
    expect(d.commission.amount).toBeCloseTo(d.clientView.net * 0.05, 2);
    expect(readiness(withReward, d, 28, []).approvals).toEqual(["quote_margin", "quote_discount"]);
    // the same plain price with a reward added afterwards would fall below the minimum
    const forced = snap(plain, 0, 5);
    expect(readiness(plain, forced, 28, []).approvals).toContain("quote_margin");
  });
});

describe("helpers", () => {
  it("amount = percent of the value before VAT, rounded to halalas", () => {
    expect(commissionAmount(10000, 5)).toBe(500);
    expect(commissionAmount(3333.33, 2.5)).toBe(83.33);
    expect(commissionAmount(1000, 0)).toBe(0);
  });

  it("totals per state (cancelled never counts)", () => {
    expect(commissionTotals([
      { status: "expected", amount: 100 }, { status: "due", amount: 50 }, { status: "paid", amount: 30 }, { status: "cancelled", amount: 999 },
    ])).toEqual({ expected: 100, due: 50, paid: 30, total: 180 });
  });

  it("partner page link: number + token, number format checked", () => {
    expect(MARKETER_NUMBER_RE.test("MK-2026-001")).toBe(true);
    expect(MARKETER_NUMBER_RE.test("C-2026-001")).toBe(false);
    expect(marketerHref("https://x.test", "MK-2026-001", "abcdefghijklmnop")).toBe("https://x.test/m/MK-2026-001/abcdefghijklmnop");
  });

  it("maps the database refusals of a payment", () => {
    expect(commissionPaymentError("commission not due")).toBe("commissionNotDue");
    expect(commissionPaymentError("commission already paid")).toBe("commissionAlreadyPaid");
    expect(commissionPaymentError("invalid date")).toBe("invalid");
    expect(commissionPaymentError("whatever")).toBeNull();
  });
});

describe("the owner's wording: «شركاء النجاح» / «المكافأة»", () => {
  it("no «عمولة» or «مسوّق» in the Arabic interface; no commission / marketer in the English one", async () => {
    const { readFileSync } = await import("node:fs");
    const values = (file: string) => {
      const out: string[] = [];
      const walk = (o: unknown) => (typeof o === "string" ? out.push(o) : o && typeof o === "object" && Object.values(o).forEach(walk));
      walk(JSON.parse(readFileSync(file, "utf8")));
      return out.join("\n");
    };
    expect(values("messages/ar.json")).not.toMatch(/عمول|مسو[ّ]?ق/);
    expect(values("messages/en.json")).not.toMatch(/commission|marketer/i);
    // the WhatsApp texts written in code too
    const wa = readFileSync("src/lib/notifications/index.ts", "utf8");
    expect(wa).not.toMatch(/عمول|مسو[ّ]?ق/);
  });
});

describe("Qoyod: a reward is an expense bill", () => {
  it("rewards account when chosen, else the general expense account; picked only at the first setup", async () => {
    const { autoSetupNext, commissionExpenseAccount, commissionBillRef } = await import("@/lib/qoyod/payloads");
    const { pickDefaults } = await import("@/lib/qoyod/defaults");
    expect(commissionExpenseAccount({ commission_account_id: 9, expense_account_id: 5 })).toBe(9);
    expect(commissionExpenseAccount({ commission_account_id: null, expense_account_id: 5 })).toBe(5);
    expect(commissionBillRef("PV-2026-001")).toBe("PV-2026-001");
    const d = pickDefaults({
      inventories: [{ id: 1, name: "w" }],
      accounts: [
        { id: 5, name: "مشتريات", code: "5100", type: "Expense", receive: false },
        { id: 9, name: "عمولات ومكافآت", code: "5300", type: "Expense", receive: false },
        { id: 8, name: "البنك", code: "1100", type: "Asset", receive: true },
      ],
    } as never);
    expect(d.commissionAccountId).toBe(9);
    const auto = { inventory_id: 1, receive_account_id: 8, expense_account_id: 5, salary_account_id: null, cash_account_id: null, subcontract_account_id: null, commission_account_id: 9, service_products: {}, addendum_product_id: 3 };
    expect(autoSetupNext(null, auto).commission_account_id).toBe(9);
    // after the first setup an empty one is the owner's choice
    expect(autoSetupNext({ auto_setup_at: "2026-11-01", commission_account_id: null }, auto).commission_account_id).toBeNull();
  });
});
