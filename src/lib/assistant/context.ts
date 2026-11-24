import type { OwnerFinance } from "@/lib/data/finance";

/**
 * The facts the assistant may use — built on the server from the owner's own data
 * (already filtered by permissions/RLS), compact enough for one request.
 */
export type MonthTotals = Record<string, number>; // "YYYY-MM" → SAR

export type AssistantFacts = {
  today: string;
  company: string;
  vatRegistered: boolean;
  cash: OwnerFinance["cash"];
  kpis: OwnerFinance["kpis"];
  collectedByMonth: MonthTotals;
  purchasesByMonth: MonthTotals;
  /** repairs the company pays (covered by the warranty); repairs charged to clients are not a cost */
  maintenanceCostByMonth: MonthTotals;
  receivables: OwnerFinance["receivables"];
  ageing: OwnerFinance["ageing"];
  latePayments: { contract: string; client: string; label: string; outstanding: number; expected: string }[];
  upcomingPayments: { contract: string; client: string; label: string; outstanding: number; expected: string }[];
  projects: { contract: string; client: string; service: string; revenue: number; expectedProfit: number | null; actualCost: number; actualProfit: number; progress: number; losing: boolean; month: string }[];
  delayed: OwnerFinance["delayed"];
  overBudget: OwnerFinance["overBudget"];
  forecast: { week: string; inflow: number; outflow: number; balance: number; shortfall: boolean }[];
  pendingApprovals: { kind: string; number: string | null; since: string }[];
  /** costs are shown without in-house labour (built from salaries: the user lacks hr.view) — profits exclude it */
  labourHidden: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function monthTotals(rows: { date: string | null; amount: number }[]): MonthTotals {
  const out: MonthTotals = {};
  for (const r of rows) {
    if (!r.date) continue;
    const m = r.date.slice(0, 7);
    out[m] = r2((out[m] ?? 0) + r.amount);
  }
  return out;
}

export function buildFacts(
  f: OwnerFinance,
  extra: { company: string; vatRegistered: boolean; collected: MonthTotals; purchases: MonthTotals; maintenance: MonthTotals },
): AssistantFacts {
  const open = f.payments.filter((p) => p.outstanding > 0.005 && p.status !== "pending");
  const pick = (p: OwnerFinance["payments"][number]) => ({ contract: p.contract, client: p.client, label: p.label, outstanding: r2(p.outstanding), expected: p.expected });
  return {
    today: f.today,
    company: extra.company,
    vatRegistered: extra.vatRegistered,
    cash: f.cash,
    kpis: f.kpis,
    collectedByMonth: extra.collected,
    purchasesByMonth: extra.purchases,
    maintenanceCostByMonth: extra.maintenance,
    receivables: f.receivables.slice(0, 40),
    ageing: f.ageing,
    latePayments: open.filter((p) => p.late).slice(0, 40).map(pick),
    upcomingPayments: f.payments.filter((p) => p.outstanding > 0.005 && !p.late).sort((a, b) => a.expected.localeCompare(b.expected)).slice(0, 30).map(pick),
    projects: f.profits.slice(0, 60).map((p) => ({
      contract: p.number, client: p.client, service: p.service, revenue: r2(p.revenue), expectedProfit: p.expected == null ? null : r2(p.expected),
      actualCost: r2(p.actualCost), actualProfit: r2(p.actual), progress: p.progress, losing: p.losing, month: p.month,
    })),
    delayed: f.delayed,
    overBudget: f.overBudget,
    forecast: f.forecast.map((w) => ({ week: w.start, inflow: r2(w.inflow), outflow: r2(w.outflow), balance: r2(w.balance), shortfall: w.shortfall })),
    pendingApprovals: f.approvals.map((a) => ({ kind: a.kind, number: typeof a.details.number === "string" ? a.details.number : null, since: a.created_at.slice(0, 10) })),
    labourHidden: !!f.labourHidden,
  };
}

/** Links the assistant may suggest (anything else is dropped). */
export const SAFE_LINK =
  /^\/(?:reports|schedule|team\/payroll|purchases\/costs|(?:purchases|projects|contracts|invoices|clients|quotations)(?:\/[A-Z]{1,3}-\d{4}-\d{3,6})?|maintenance(?:\?r=MR-\d{4}-\d{3,6})?)$/;

/** The permissions each page the assistant can link to needs (the same as the page's own guards). */
const LINK_PERMISSION: [RegExp, string[]][] = [
  [/^\/reports$/, ["finance.view"]],
  [/^\/invoices(?:\/|$)/, ["finance.view"]],
  [/^\/schedule$/, ["schedule.view"]],
  [/^\/team\/payroll$/, ["hr.view"]],
  // the costs page sits inside the purchases section (its layout needs purchases.view)
  [/^\/purchases\/costs$/, ["costs.view", "purchases.view"]],
  [/^\/purchases(?:\/|$)/, ["purchases.view"]],
  [/^\/(?:projects|maintenance)(?:[/?]|$)/, ["projects.view"]],
  [/^\/(?:contracts|quotations)(?:\/|$)/, ["quotes.view"]],
  [/^\/clients(?:\/|$)/, ["clients.view"]],
];
const DOC_NO = /[A-Z]{1,3}-\d{4}-\d{3,6}/g;

/**
 * Links the assistant suggested, kept only when they are on the allowed list, the asker may
 * open the page, and any document number in them appears in the facts he was given.
 */
export function assistantLinks<L extends { href: string }>(links: L[], permissions: readonly string[], facts: unknown): L[] {
  const known = new Set(JSON.stringify(facts ?? {}).match(DOC_NO) ?? []);
  return links.filter((l) => {
    if (!SAFE_LINK.test(l.href)) return false;
    const need = LINK_PERMISSION.find(([re]) => re.test(l.href))?.[1];
    if (!need || !need.every((p) => permissions.includes(p))) return false;
    return (l.href.match(DOC_NO) ?? []).every((n) => known.has(n));
  });
}
