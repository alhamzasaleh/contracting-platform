/**
 * Contracts (Phase 4) — pure helpers: payment schedule amounts, the 75 %
 * first-payment warning, suggested duration and link expiry.
 */
import type { ServiceKind } from "@/lib/pricing";

export type DueEvent = "signing" | "material_supply" | "board_closing" | "primer_done" | "handover" | "custom";
export type PaymentDraft = { label: string; percent: number; due_event: DueEvent };

/** Default stages (A.6 for gypsum); the owner enters the percentages. */
export function defaultStages(service: ServiceKind): { key: DueEvent }[] {
  return service === "gypsum"
    ? [{ key: "signing" }, { key: "material_supply" }, { key: "board_closing" }, { key: "handover" }]
    : [{ key: "signing" }, { key: "material_supply" }, { key: "primer_done" }, { key: "handover" }];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Amounts from percentages; the last payment absorbs rounding so the sum equals the total. */
export function scheduleAmounts(total: number, percents: number[]): number[] {
  const amounts = percents.map((p) => r2((total * p) / 100));
  if (amounts.length) amounts[amounts.length - 1] = r2(total - amounts.slice(0, -1).reduce((a, b) => a + b, 0));
  return amounts;
}

export const percentSum = (percents: number[]) => r2(percents.reduce((a, b) => a + b, 0));

/** Cap one payment's percentage so the schedule never totals more than 100 %. */
export function capPercent(value: number, others: number[]): number {
  const room = Math.max(0, r2(100 - percentSum(others)));
  return r2(Math.min(Math.max(0, value), room));
}

/** §3.7: warn (not block) when the first payment covers less than 75 % of the material cost. */
export function firstPaymentWarning(firstAmount: number, materialCost: number, threshold = 75): { warn: boolean; coverage: number } {
  if (materialCost <= 0) return { warn: false, coverage: 100 };
  const coverage = r2((firstAmount / materialCost) * 100);
  return { warn: coverage < threshold, coverage };
}

/** Days = total area ÷ team productivity (m²/day), at least 1. */
export function suggestedDays(area: number, productivity: number): number {
  return Math.max(1, Math.ceil(area / Math.max(1, productivity)));
}

/** The client page stays valid until the warranty ends (+30 days grace), at least 90 days. */
export function linkExpiry(startDate: string, durationDays: number, warrantyMonths: number, now = new Date()): Date {
  const end = new Date(`${startDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + durationDays + 30);
  end.setUTCMonth(end.getUTCMonth() + warrantyMonths);
  const min = new Date(now.getTime() + 90 * 86_400_000);
  return end > min ? end : min;
}
