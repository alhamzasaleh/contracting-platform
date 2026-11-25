/**
 * Success partners («شركاء النجاح» — code name: marketers) and their reward («المكافأة» — code
 * name: commission). Owner, Nov 2026. Pure helpers; the database owns the rules (frozen
 * percentage, due after the original contract is fully paid, paid once with a PV- voucher).
 */
export type CommissionStatus = "expected" | "due" | "paid" | "cancelled";

export const MARKETER_NUMBER_RE = /^MK-\d{4}-\d{3,6}$/;

/** percent of the value before VAT, rounded to halalas (same as the database) */
export const commissionAmount = (base: number, percent: number) => Math.round(base * percent) / 100;

/** the reward on the net after the client's discount, before VAT (what the quote version freezes) */
export function commissionOnNet(subtotal: number, discountPercent: number, percent: number): number {
  const net = Math.round(subtotal * (1 - Math.min(100, Math.max(0, discountPercent)) / 100) * 100) / 100;
  return commissionAmount(net, Math.max(0, percent));
}

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

/**
 * The quote editor sends the partner and the reward % it priced with; the server re-reads the
 * partner: unknown → invalid, inactive → partnerInactive, a different % → rewardChanged.
 */
export function partnerCheck(
  partner: { is_active: boolean; commission_percent: number | null } | null | undefined,
  wanted: boolean,
  shownPercent: number | undefined,
): "invalid" | "partnerInactive" | "rewardChanged" | null {
  if (!wanted) return null;
  if (!partner || partner.commission_percent == null || shownPercent === undefined) return "invalid";
  if (!partner.is_active) return "partnerInactive";
  if (shownPercent !== partner.commission_percent) return "rewardChanged";
  return null;
}

/** The partner the quote editor starts with: the quote's own once chosen (null = removed on purpose), else the client's «جاء عن طريق». */
export function defaultPartner(quote: { marketer_id?: string | null; marketer_set?: boolean } | null, clientMarketer: string | null | undefined): string | null {
  if (quote?.marketer_set) return quote.marketer_id ?? null;
  return clientMarketer ?? null;
}
