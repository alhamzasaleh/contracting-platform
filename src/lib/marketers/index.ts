/**
 * Success partners («شركاء النجاح» — code name: marketers) and their reward («المكافأة» — code
 * name: commission). Owner, Nov 2026. Pure helpers; the database owns the rules (frozen
 * percentage, due after the original contract is fully paid, paid once with a PV- voucher).
 */
export type CommissionStatus = "expected" | "due" | "paid" | "cancelled";

export const MARKETER_NUMBER_RE = /^MK-\d{4}-\d{3,6}$/;

/** percent of the value before VAT, rounded to halalas (same as the database) */
export const commissionAmount = (base: number, percent: number) => Math.round(base * percent) / 100;

/** expected / due / paid totals; a cancelled reward never counts */
export function commissionTotals(rows: { status: CommissionStatus; amount: number }[]) {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const sum = (s: CommissionStatus) => r2(rows.filter((x) => x.status === s).reduce((a, x) => a + Number(x.amount), 0));
  const expected = sum("expected");
  const due = sum("due");
  const paid = sum("paid");
  return { expected, due, paid, total: r2(expected + due + paid) };
}

export const marketerHref = (base: string, number: string, token: string) => `${base}/m/${number}/${token}`;

/** public.record_commission_payment refusals → message keys */
export function commissionPaymentError(message: string | null | undefined): "commissionNotDue" | "commissionAlreadyPaid" | "invalid" | null {
  const m = message ?? "";
  if (/already paid/.test(m)) return "commissionAlreadyPaid";
  if (/not due|nothing to pay/.test(m)) return "commissionNotDue";
  if (/invalid/.test(m)) return "invalid";
  return null;
}
