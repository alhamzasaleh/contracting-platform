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

/**
 * The last moment a client-page link is valid: it expires at Riyadh midnight after the last day
 * (warranty end + 1 day), so "valid until" shows expires_at − 1 ms — the same day as the warranty end.
 */
export function lastValidDay(expiresAt: string | Date): string {
  return new Date(new Date(expiresAt).getTime() - 1).toISOString();
}

/** Planned delivery: start + duration + accepted additional works' days (contract page, project page, alerts). */
export function deliveryDate(start: string, days: number, extraDays: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days + extraDays);
  return d.toISOString().slice(0, 10);
}

/** Expected delivery after accepted addenda (each adds its days). */
export function deliveryWithAddenda(start: string, days: number, addenda: { status: string; extra_days: number }[]) {
  const extra = addenda.filter((a) => a.status === "accepted").reduce((s, a) => s + a.extra_days, 0);
  return { date: deliveryDate(start, days, extra), extra };
}

/**
 * The client-page link on the contract page: before acceptance it carries the quote and
 * contract; after acceptance the client follows the project, payments and warranty. Once
 * the warranty has ended (warranty end < today, Riyadh) the page closes — no reissue.
 */
export function portalLinkState(status: string, warrantyEnd: string | null, today: string): { canIssue: boolean; message: "waMessage" | "waMessageProject"; warrantyEnded: boolean } {
  const warrantyEnded = !!warrantyEnd && warrantyEnd < today;
  return { canIssue: status !== "cancelled" && !warrantyEnded, message: status === "accepted" ? "waMessageProject" : "waMessage", warrantyEnded };
}

/**
 * Which message a refused contract save shows (create_contract / save_contract_schedule):
 * a locked contract, the 100 % rule, an unissued quote, or any other invalid schedule.
 * null = not a schedule problem (the caller's generic handling decides).
 */
export function scheduleSaveError(error: { code?: string; message?: string } | null | undefined): "contractLocked" | "paymentsSum" | "quoteNotIssued" | "needsApproval" | "scheduleInvalid" | null {
  if (!error) return null;
  const m = error.message ?? "";
  if (/contract is locked/.test(m)) return "contractLocked";
  if (/must total 100/.test(m)) return "paymentsSum";
  // the quote itself (create_contract, check_contract_quote)
  if (/quote not issued|needs an issued quote/.test(m)) return "quoteNotIssued";
  if (/waiting for the owner/.test(m)) return "needsApproval";
  if (error.code === "22023") return "scheduleInvalid";
  return null;
}
