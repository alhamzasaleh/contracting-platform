import "server-only";
import { can, type SessionContext } from "@/lib/auth/session";
import { loadProjectCosts } from "@/lib/data/purchases";
import type { Line } from "@/lib/engine";
import { overallProgress } from "@/lib/execution";
import { ageing, expectedPaymentDate, paydays, projectProfit, weeklyForecast, type AgeBucket, type DueEvent, type Flow, type ForecastWeek } from "@/lib/finance";
import type { ServiceKind } from "@/lib/pricing";
import { costStatus } from "@/lib/purchases";
import { addDays } from "@/lib/schedule";
import { createClient } from "@/lib/supabase/server";

const n = (v: unknown) => Number(v ?? 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

export type PaymentRow = {
  id: string; contract_id: string; contract: string; client: string; seq: number; label: string; amount: number; paid: number; outstanding: number;
  status: "pending" | "requested" | "paid"; requested_at: string | null; expected: string; paid_at: string | null; late: boolean;
  /** what triggers the request (material supply / custom payments are requested by staff) */
  due_event?: DueEvent;
  /** for the ready WhatsApp reminder (owner's own WhatsApp) */
  client_phone?: string | null;
};
export type ProfitRow = {
  id: string; number: string; client: string; service: ServiceKind; revenue: number; estimatedCost: number | null; actualCost: number;
  expected: number | null; actual: number; expectedMargin: number | null; actualMargin: number | null; losing: boolean; progress: number; month: string;
};
export type ApprovalRow = { id: string; kind: string; entity: string; entity_id: string; details: Record<string, unknown>; created_at: string; link: string | null };
export type OwnerFinance = {
  today: string;
  /** signs the ready WhatsApp messages */
  orgName?: string;
  cash: { balance: number; on: string; payday: number };
  kpis: { outstanding: number; collectedMonth: number; dueSoon: number; activeProjects: number; payroll: number };
  forecast: ForecastWeek[];
  receivables: { client: string; outstanding: number; paid: number; total: number }[];
  ageing: Record<AgeBucket, number>;
  payments: PaymentRow[];
  profits: ProfitRow[];
  delayed: { number: string; client: string; due: string; days: number; progress: number }[];
  overBudget: { number: string; client: string; ratio: number }[];
  approvals: ApprovalRow[];
  /** this month's loaded cost of our in-house team vs what projects absorbed (costs.view + finance.view; totals only) */
  /** in-house team cost this month: full month, allocated to projects, the share of the month gone so far, and the part not carried by projects */
  teamCost?: { monthly: number; allocated: number; toDate: number; unabsorbed: number } | null;
  canManage: boolean;
  canDecide: boolean;
};

/** Everything the owner's home needs (§3.16). finance.view; each part follows its own permission via RLS. */
export async function loadOwnerFinance(session: SessionContext, today: string): Promise<OwnerFinance> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: contracts }, { data: clients }, { data: settings }, { data: addenda }, { data: approvals }, { data: stages }] = await Promise.all([
    supabase.from("contracts").select("id, number, client_id, service, status, start_date, duration_days, total, quote_id, quote_version, accepted_at").eq("organization_id", orgId).eq("status", "accepted"),
    supabase.from("clients").select("id, name, phone").eq("organization_id", orgId),
    supabase.from("finance_settings").select("cash_balance, cash_balance_on, payday").eq("organization_id", orgId).maybeSingle(),
    supabase.from("addenda").select("id, contract_id, number, title, amount, vat, total, extra_days, status, payment_status, accepted_at, paid_amount, paid_at").eq("organization_id", orgId).eq("status", "accepted"),
    supabase.from("approvals").select("id, kind, entity, entity_id, details, created_at").eq("organization_id", orgId).eq("status", "pending").order("created_at"),
    supabase.from("project_stages").select("contract_id, status, progress, is_final").eq("organization_id", orgId),
  ]);
  const ids = (contracts ?? []).map((c) => c.id);
  const [{ data: payments }, { data: versions }] = await Promise.all([
    ids.length ? supabase.from("contract_payments").select("id, contract_id, seq, label, amount, due_event, status, requested_at, expected_date, paid_amount, paid_at").in("contract_id", ids).order("seq") : Promise.resolve({ data: [] as never[] }),
    ids.length ? supabase.from("quote_versions").select("id, quote_id, version, client_view").in("quote_id", (contracts ?? []).map((c) => c.quote_id)) : Promise.resolve({ data: [] as never[] }),
  ]);
  const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const clientPhone = new Map((clients ?? []).map((c) => [c.id, (c as { phone?: string | null }).phone ?? null]));
  const extraDays = new Map<string, number>();
  for (const a of addenda ?? []) extraDays.set(a.contract_id, (extraDays.get(a.contract_id) ?? 0) + a.extra_days);
  const contractOf = new Map((contracts ?? []).map((c) => [c.id, c]));

  // --- payments (collections) -------------------------------------------------------
  const rows: PaymentRow[] = ((payments ?? []) as { id: string; contract_id: string; seq: number; label: string; amount: number; due_event: DueEvent; status: "pending" | "requested" | "paid"; requested_at: string | null; expected_date: string | null; paid_amount: number | null; paid_at: string | null }[]).map((p) => {
    const c = contractOf.get(p.contract_id)!;
    const amount = n(p.amount);
    const paid = n(p.paid_amount);
    const expected = expectedPaymentDate(p, { start_date: c.start_date, days: c.duration_days + (extraDays.get(c.id) ?? 0) }, today);
    return {
      id: p.id, contract_id: p.contract_id, contract: c.number, client: clientName.get(c.client_id) ?? "—", seq: p.seq, label: p.label, amount, paid,
      outstanding: r2(Math.max(0, amount - paid)), status: p.status, requested_at: p.requested_at, expected, paid_at: p.paid_at,
      late: p.status === "requested" && !!p.requested_at && p.requested_at.slice(0, 10) <= addDays(today, -7),
      client_phone: clientPhone.get(c.client_id) ?? null, due_event: p.due_event,
    };
  });
  // addenda payments: requested on acceptance, a separate line each (money recorded by record_addendum_payment)
  for (const a of addenda ?? []) {
    const c = contractOf.get(a.contract_id);
    if (!c) continue;
    const total = n(a.total);
    const paid = n(a.paid_amount);
    const status = a.payment_status === "paid" ? "paid" : "requested";
    rows.push({
      id: `ad:${a.id}`, contract_id: a.contract_id, contract: c.number, client: clientName.get(c.client_id) ?? "—", seq: 99, label: `${a.number} — ${a.title}`,
      amount: total, paid, outstanding: r2(Math.max(0, total - paid)), status, requested_at: a.accepted_at, expected: today, paid_at: a.paid_at ?? null,
      late: status === "requested" && !!a.accepted_at && a.accepted_at.slice(0, 10) <= addDays(today, -7),
      client_phone: clientPhone.get(c.client_id) ?? null,
    });
  }

  // --- outflows -----------------------------------------------------------------------
  const payday = settings?.payday ?? 27;
  const horizon = addDays(today, 12 * 7);
  const outflows: Flow[] = [];
  let payroll = 0;
  if (can(session, "hr.view")) {
    const { data: employees } = await supabase.from("employees").select("basic_salary, housing_allowance, transport_allowance, other_allowances, status").eq("organization_id", orgId).neq("status", "final_exit");
    payroll = r2((employees ?? []).reduce((s, e) => s + n(e.basic_salary) + n(e.housing_allowance) + n(e.transport_allowance) + n(e.other_allowances), 0));
    if (payroll > 0) for (const d of paydays(today, payday, horizon)) outflows.push({ date: d, amount: payroll, label: "salaries", kind: "payroll" });
  }
  if (can(session, "purchases.view")) {
    const [{ data: work }, { data: paid }, { data: pending }, { data: petty }] = await Promise.all([
      supabase.from("subcontractor_work").select("agreement_id, amount").eq("organization_id", orgId).limit(20000),
      supabase.from("subcontractor_payments").select("agreement_id, amount").eq("organization_id", orgId).limit(20000),
      supabase.from("purchases").select("number, total").eq("organization_id", orgId).eq("status", "pending_approval"),
      supabase.from("petty_cash_entries").select("account_id, kind, amount").eq("organization_id", orgId).limit(20000),
    ]);
    const earned = (work ?? []).reduce((s, w) => s + n(w.amount), 0);
    const paidSubs = (paid ?? []).reduce((s, p) => s + n(p.amount), 0);
    if (earned - paidSubs > 0.005) outflows.push({ date: today, amount: r2(earned - paidSubs), label: "subcontractors", kind: "subcontractors" });
    for (const p of pending ?? []) outflows.push({ date: today, amount: n(p.total), label: p.number, kind: "purchase" });
    // a holder who fronted money (negative petty cash) is reimbursed now
    const byAccount = new Map<string, number>();
    for (const e of petty ?? []) byAccount.set(e.account_id, (byAccount.get(e.account_id) ?? 0) + (e.kind === "topup" ? n(e.amount) : -n(e.amount)));
    const owed = [...byAccount.values()].filter((b) => b < 0).reduce((s, b) => s - b, 0);
    if (owed > 0.005) outflows.push({ date: today, amount: r2(owed), label: "petty", kind: "petty" });
  }
  const inflows: Flow[] = rows.filter((r) => r.outstanding > 0).map((r) => ({ date: r.expected, amount: r.outstanding, label: `${r.client} · ${r.label}`, kind: "client" }));
  const opening = n(settings?.cash_balance);

  // --- receivables ----------------------------------------------------------------------
  const due = rows.filter((r) => r.status !== "pending" || r.paid > 0);
  const byClient = new Map<string, { client: string; outstanding: number; paid: number; total: number }>();
  for (const r of due) {
    const x = byClient.get(r.client) ?? { client: r.client, outstanding: 0, paid: 0, total: 0 };
    x.outstanding = r2(x.outstanding + (r.status === "pending" ? 0 : r.outstanding));
    x.paid = r2(x.paid + r.paid);
    x.total = r2(x.total + r.amount);
    byClient.set(r.client, x);
  }

  // --- profit per project ---------------------------------------------------------------
  const costs = await loadProjectCosts(session);
  const costOf = new Map(costs.map((c) => [c.id, c]));
  let estimated = new Map<string, number>();
  if (can(session, "costs.view") && versions?.length) {
    const vid = (versions as { id: string; quote_id: string; version: number }[]).filter((v) => (contracts ?? []).some((c) => c.quote_id === v.quote_id && c.quote_version === v.version));
    const { data: vc } = vid.length ? await supabase.from("quote_version_costs").select("quote_version_id, lines").in("quote_version_id", vid.map((v) => v.id)) : { data: [] };
    const total = new Map((vc ?? []).map((x) => [x.quote_version_id, (x.lines as unknown as Line[]).reduce((s, l) => s + l.cost, 0)]));
    estimated = new Map((contracts ?? []).map((c) => [c.id, total.get(vid.find((v) => v.quote_id === c.quote_id && v.version === c.quote_version)?.id ?? "") ?? 0]).filter(([, v]) => (v as number) > 0) as [string, number][]);
  }
  const profits: ProfitRow[] = (contracts ?? []).map((c) => {
    const view = (versions as { quote_id: string; version: number; client_view: { vat?: number } }[] | null)?.find((v) => v.quote_id === c.quote_id && v.version === c.quote_version)?.client_view;
    const addRevenue = (addenda ?? []).filter((a) => a.contract_id === c.id).reduce((s, a) => s + n(a.amount), 0);
    const revenue = r2(n(c.total) - n(view?.vat) + addRevenue);
    const cost = costOf.get(c.id);
    const actualCost = r2((cost?.actual ?? 0) + (cost?.subcontractors ?? 0) + (cost?.labour ?? 0));
    const pr = projectProfit(revenue, estimated.get(c.id) ?? null, actualCost);
    const own = (stages ?? []).filter((s) => s.contract_id === c.id);
    return {
      id: c.id, number: c.number, client: clientName.get(c.client_id) ?? "—", service: c.service, revenue, estimatedCost: estimated.get(c.id) ?? null, actualCost,
      ...pr, progress: overallProgress(own), month: (c.accepted_at ?? c.start_date).slice(0, 7),
    };
  });

  // --- delayed & over budget --------------------------------------------------------------
  const delayed = (contracts ?? [])
    .map((c) => {
      const end = addDays(c.start_date, c.duration_days + (extraDays.get(c.id) ?? 0));
      const own = (stages ?? []).filter((s) => s.contract_id === c.id);
      const handedOver = own.some((s) => s.is_final && s.status === "confirmed");
      return { number: c.number, client: clientName.get(c.client_id) ?? "—", due: end, days: Math.round((Date.parse(today) - Date.parse(end)) / 86_400_000), progress: overallProgress(own), handedOver };
    })
    .filter((d) => !d.handedOver && d.days > 0)
    .map((d) => ({ number: d.number, client: d.client, due: d.due, days: d.days, progress: d.progress }));
  const overBudget = costs
    .map((c) => ({ number: c.number, client: c.client, ratio: costStatus(c.estimated, c.actual).ratio ?? 0 }))
    .filter((c) => c.ratio > 1);

  // our team's fixed cost: how much of this month is charged to projects (the rest is covered by the overhead %)
  let teamCost: OwnerFinance["teamCost"] = null;
  if (can(session, "costs.view") && can(session, "finance.view")) {
    const { data: tc } = await supabase.rpc("team_cost_month", { p_org: orgId });
    const row = tc?.[0];
    if (row && n(row.monthly) > 0) teamCost = { monthly: n(row.monthly), allocated: n(row.allocated), toDate: n(row.to_date), unabsorbed: r2(Math.max(0, n(row.to_date) - n(row.allocated))) };
  }

  const monthStart = today.slice(0, 7);
  return {
    today,
    orgName: session.organization.name,
    cash: { balance: opening, on: settings?.cash_balance_on ?? today, payday },
    kpis: {
      outstanding: r2([...byClient.values()].reduce((s, x) => s + x.outstanding, 0)),
      collectedMonth: r2(rows.filter((r) => r.paid_at?.slice(0, 7) === monthStart).reduce((s, r) => s + r.paid, 0)),
      dueSoon: r2(rows.filter((r) => r.outstanding > 0 && r.expected <= addDays(today, 14)).reduce((s, r) => s + r.outstanding, 0)),
      activeProjects: (contracts ?? []).length - (contracts ?? []).filter((c) => (stages ?? []).some((s) => s.contract_id === c.id && s.is_final && s.status === "confirmed")).length,
      payroll,
    },
    forecast: weeklyForecast(opening, inflows, outflows, today, 12),
    receivables: [...byClient.values()].filter((x) => x.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding),
    ageing: ageing(rows.filter((r) => r.status === "requested").map((r) => ({ requested_at: r.requested_at, outstanding: r.outstanding })), today),
    payments: rows,
    profits,
    delayed,
    overBudget,
    approvals: (approvals ?? []).map((a) => {
      const d = (a.details ?? {}) as Record<string, unknown>;
      const num = typeof d.number === "string" ? d.number : null;
      const link = a.entity === "purchase" && num ? `/purchases/${num}` : a.entity === "quote" && num ? `/quotations/${num}` : null;
      return { id: a.id, kind: a.kind, entity: a.entity, entity_id: a.entity_id, details: d, created_at: a.created_at, link };
    }),
    teamCost,
    canManage: can(session, "finance.manage"),
    canDecide: can(session, "approvals.decide"),
  };
}
