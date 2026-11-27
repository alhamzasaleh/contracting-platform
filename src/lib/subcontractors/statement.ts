/**
 * A subcontractor's statement of account (owner, Nov 2026): every recorded work (what he earned) and every
 * payment (what he received), oldest first, with a running balance = earned − paid (positive = we owe him).
 * Pure — the same rows feed the staff statement, its print / PDF and his own page.
 */
const r2 = (x: number) => Math.round(x * 100) / 100;

export type StatementAgreement = { id: string; contract: string; client: string; scope: string };
export type StatementWork = { agreement_id: string; work_date: string; quantity_m2: number | null; percent: number | null; amount: number; note: string | null };
export type StatementPayment = { agreement_id: string; number: string; paid_on: string; amount: number; method: string };

export type StatementRow = {
  date: string;
  kind: "work" | "payment";
  contract: string;
  client: string;
  scope: string;
  /** m² or % of the job (work), the voucher number (payment) */
  quantity_m2: number | null;
  percent: number | null;
  voucher: string | null;
  note: string | null;
  earned: number;
  paid: number;
  balance: number;
};

export function subStatement(agreements: StatementAgreement[], work: StatementWork[], payments: StatementPayment[]) {
  const ag = new Map(agreements.map((a) => [a.id, a]));
  const base = (id: string) => ag.get(id) ?? { contract: "—", client: "—", scope: "" };
  const items = [
    ...work.filter((w) => ag.has(w.agreement_id)).map((w) => ({ date: w.work_date, order: 0, kind: "work" as const, a: base(w.agreement_id), w })),
    ...payments.filter((p) => ag.has(p.agreement_id)).map((p) => ({ date: p.paid_on, order: 1, kind: "payment" as const, a: base(p.agreement_id), p })),
  ].sort((x, y) => (x.date === y.date ? x.order - y.order : x.date < y.date ? -1 : 1));
  let balance = 0;
  let earned = 0;
  let paid = 0;
  const rows: StatementRow[] = items.map((i) => {
    const e = i.kind === "work" ? r2(i.w.amount) : 0;
    const p = i.kind === "payment" ? r2(i.p.amount) : 0;
    earned = r2(earned + e);
    paid = r2(paid + p);
    balance = r2(balance + e - p);
    return {
      date: i.date, kind: i.kind, contract: i.a.contract, client: i.a.client, scope: i.a.scope,
      quantity_m2: i.kind === "work" ? i.w.quantity_m2 : null, percent: i.kind === "work" ? i.w.percent : null,
      voucher: i.kind === "payment" ? i.p.number : null, note: i.kind === "work" ? i.w.note : null,
      earned: e, paid: p, balance,
    };
  });
  return { rows, totals: { earned, paid, balance } };
}

/** One subcontractor's totals over all his projects (agreed, earned, paid, due now). */
export function subTotals(agreements: { basis: "lump" | "per_m2"; rate: number; quantity_m2: number | null; work: { amount: number }[]; payments: { amount: number }[] }[]) {
  let agreed = 0;
  let earned = 0;
  let paid = 0;
  for (const g of agreements) {
    agreed += g.basis === "lump" ? g.rate : g.rate * (g.quantity_m2 ?? 0);
    earned += g.work.reduce((a, w) => a + w.amount, 0);
    paid += g.payments.reduce((a, p) => a + p.amount, 0);
  }
  return { agreed: r2(agreed), earned: r2(earned), paid: r2(paid), due: r2(earned - paid), projects: agreements.length };
}

export const SUB_NUMBER_RE = /^SC-\d{4}-\d{3,6}$/;
export const SUB_VOUCHER_RE = /^SP-\d{4}-\d{3,6}$/;
