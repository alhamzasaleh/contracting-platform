import "server-only";
import { getTranslations } from "next-intl/server";
import { can, type SessionContext } from "@/lib/auth/session";
import { loadProjectCosts } from "@/lib/data/purchases";
import type { Line } from "@/lib/engine";
import { overallProgress } from "@/lib/execution";
import { employeeCost, type CostItem } from "@/lib/costing";
import { addendumPaid, ageing, cashStatutoryItems, expectedPaymentDate, paydays, payrollFlows, projectProfit, remainingAmount, weeklyForecast, type AgeBucket, type DueEvent, type Flow, type ForecastWeek } from "@/lib/finance";
import type { ServiceKind } from "@/lib/pricing";
import { costStatus } from "@/lib/purchases";
import { addDays } from "@/lib/schedule";
import { once, rows as rowsOf } from "@/lib/data/query";
import { createClient } from "@/lib/supabase/server";
import { ltr } from "@/lib/utils";

const n = (v: unknown) => Number(v ?? 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

export type PaymentRow = {
  id: string; contract_id: string; contract: string; client: string; seq: number; label: string; amount: number; paid: number; outstanding: number;
  status: "pending" | "requested" | "paid"; requested_at: string | null; expected: string; paid_at: string | null; late: boolean;
  /** what triggers the request (material supply / custom payments are requested by staff) */
  due_event?: DueEvent;
  /** staff can ask for it now (pending, and no stage confirmation will request it) */
  requestable?: boolean;
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
  /** costs are shown but in-house labour isn't (it is built from salaries: needs hr.view) */
  labourHidden?: boolean;
  /** success partners' rewards: due now (to pay) and expected (paid once their contracts are fully paid) */
  rewards?: { due: number; dueCount: number; expected: number } | null;
  /** owed back to clients after signed measurement sheets, not paid back yet */
  owedToClients?: number;
  canManage: boolean;
  canDecide: boolean;
  /** which pages the viewer may open from here: contracts (quotes.view), projects (projects.view), costs (costs.view + purchases.view), schedule (schedule.view) */
  links: { contracts: boolean; projects: boolean; costs: boolean; schedule: boolean };
};

type ApprovalDbRow = { id: string; kind: string; entity: string; entity_id: string; details: unknown; created_at: string };
function approvalRow(a: ApprovalDbRow): ApprovalRow {
  const d = (a.details ?? {}) as Record<string, unknown>;
  const num = typeof d.number === "string" ? d.number : null;
  const contract = typeof d.contract === "string" ? d.contract : null;
  const link =
    a.entity === "purchase" && num ? `/purchases/${num}`
    : a.entity === "quote" && num ? `/quotations/${num}`
    : a.entity === "addendum" && contract ? `/contracts/${contract}`
    : null;
  return { id: a.id, kind: a.kind, entity: a.entity, entity_id: a.entity_id, details: d, created_at: a.created_at, link };
}

/** Pending approvals for the home card of someone who decides them without finance.view. */
export async function loadPendingApprovals(session: SessionContext): Promise<ApprovalRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("approvals").select("id, kind, entity, entity_id, details, created_at").eq("organization_id", session.organization.id).eq("status", "pending").order("created_at");
  return (data ?? []).map(approvalRow);
}

/** Everything the owner's home needs (§3.16). finance.view; each part follows its own permission via RLS. */
export async function loadOwnerFinance(session: SessionContext, today: string): Promise<OwnerFinance> {
  const settlementLabel = (await getTranslations("measure"))("settlementLabel");
  const supabase = await createClient();
  const orgId = session.organization.id;
  // Every query starts at once; the few that need another's answer are chained onto it, so the
  // whole page costs about three database round trips (`once`: a query shared by chained ones is sent once).
  const contractsP = once(supabase.from("contracts").select("id, number, client_id, service, status, start_date, duration_days, total, quote_id, quote_version, accepted_at").eq("organization_id", orgId).eq("status", "accepted"));
  const addendaP = once(supabase.from("addenda").select("id, contract_id, number, title, amount, vat, total, extra_days, status, payment_status, accepted_at, paid_amount, paid_at").eq("organization_id", orgId).eq("status", "accepted"));
  const versionsP = contractsP.then(({ data: list }) =>
    list?.length ? rowsOf(supabase.from("quote_versions").select("id, quote_id, version, client_view").in("quote_id", list.map((c) => c.quote_id))) : [],
  );
  const seeHr = can(session, "hr.view");
  const seeEstimates = can(session, "costs.view");
  const [
    { data: contracts }, { data: clients }, { data: settings }, { data: addenda }, { data: approvals }, { data: stages },
    payments, versions, requestableRows,
    hr, spend, costs, estimatedTotals, { data: tc }, { data: monthReceipts }, rewardRows, measureRows,
  ] = await Promise.all([
    contractsP,
    supabase.from("clients").select("id, name, phone").eq("organization_id", orgId),
    supabase.from("finance_settings").select("cash_balance, cash_balance_on, payday").eq("organization_id", orgId).maybeSingle(),
    addendaP,
    supabase.from("approvals").select("id, kind, entity, entity_id, details, created_at").eq("organization_id", orgId).eq("status", "pending").order("created_at"),
    supabase.from("project_stages").select("contract_id, status, progress, is_final").eq("organization_id", orgId),
    contractsP.then(({ data: list }) =>
      list?.length ? rowsOf(supabase.from("contract_payments").select("id, contract_id, seq, label, amount, due_event, status, requested_at, expected_date, paid_amount, paid_at, kind").in("contract_id", list.map((c) => c.id)).order("seq")) : [],
    ),
    versionsP,
    // exactly what request_contract_payment accepts for this user (stages may be hidden from him)
    contractsP.then(({ data: list }) => (list?.length ? rowsOf(supabase.rpc("requestable_payments", { p_org: orgId })) : [])),
    seeHr
      ? Promise.all([
          supabase.from("employees").select("is_saudi, basic_salary, housing_allowance, transport_allowance, other_allowances, status").eq("organization_id", orgId).neq("status", "final_exit"),
          supabase.from("employee_cost_items").select("code, applies_to, basis, value, amortize_months, is_active, is_provision").eq("organization_id", orgId),
          supabase
            .from("payroll_runs").select("id, month, status").eq("organization_id", orgId).gte("month", `${today.slice(0, 7)}-01`).order("month").limit(12)
            .then(async ({ data: runs }) => {
              const runIds = (runs ?? []).map((r) => r.id);
              const { data: lines } = runIds.length ? await supabase.from("payroll_lines").select("run_id, net").in("run_id", runIds) : { data: [] as { run_id: string; net: number }[] };
              return { runs: runs ?? [], lines: lines ?? [] };
            }),
        ])
      : Promise.resolve(null),
    can(session, "purchases.view")
      ? Promise.all([
          supabase.from("subcontractor_work").select("agreement_id, amount").eq("organization_id", orgId).limit(20000),
          supabase.from("subcontractor_payments").select("agreement_id, amount").eq("organization_id", orgId).limit(20000),
          supabase.from("purchases").select("number, total").eq("organization_id", orgId).eq("status", "pending_approval"),
          supabase.from("petty_cash_entries").select("account_id, kind, amount").eq("organization_id", orgId).limit(20000),
        ])
      : Promise.resolve(null),
    loadProjectCosts(session),
    // estimated total cost per accepted contract: its quote version's lines (+ accepted addenda's own estimate)
    seeEstimates
      ? Promise.all([
          Promise.all([contractsP, versionsP]).then(async ([{ data: list }, vs]) => {
            const vid = (vs as { id: string; quote_id: string; version: number }[]).filter((v) => (list ?? []).some((c) => c.quote_id === v.quote_id && c.quote_version === v.version));
            const { data: vc } = vid.length ? await supabase.from("quote_version_costs").select("quote_version_id, lines").in("quote_version_id", vid.map((v) => v.id)) : { data: [] };
            return { vid, total: new Map((vc ?? []).map((x) => [x.quote_version_id, (x.lines as unknown as Line[]).reduce((s, l) => s + l.cost, 0)])) };
          }),
          addendaP.then(async ({ data: ads }) => {
            const accepted = (ads ?? []).map((a) => a.id);
            return accepted.length ? ((await supabase.from("addendum_costs").select("addendum_id, contract_id, material_cost, other_cost").in("addendum_id", accepted)).data ?? []) : [];
          }),
        ])
      : Promise.resolve(null),
    // our team's fixed cost: how much of this month is charged to projects (the rest is covered by the overhead %)
    seeEstimates && can(session, "finance.view") && seeHr ? supabase.rpc("team_cost_month", { p_org: orgId }) : Promise.resolve({ data: null }),
    // collected this month = the receipt vouchers issued this month (contract payments and addenda, partial too)
    supabase.from("client_receipts").select("amount").eq("organization_id", orgId).gte("paid_on", `${today.slice(0, 7)}-01`).lte("paid_on", today),
    // success partners' rewards (RLS: finance.view / costs.view / marketers.manage) — not cancelled
    rowsOf(supabase.from("marketer_commissions").select("contract_id, amount, status").eq("organization_id", orgId).in("status", ["expected", "due", "paid"])),
    // quantity settlement the client signed (measurement sheets): changes the project's revenue (before VAT)
    rowsOf(supabase.from("contract_measurements").select("contract_id, diff_subtotal, credit_amount, refunded_at").eq("organization_id", orgId).eq("status", "approved")),
  ]);
  const measured = new Map<string, number>();
  for (const m of measureRows) measured.set(m.contract_id, (measured.get(m.contract_id) ?? 0) + n(m.diff_subtotal));
  const requestable = new Set((requestableRows ?? []).map((r) => r.payment_id));
  const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const clientPhone = new Map((clients ?? []).map((c) => [c.id, (c as { phone?: string | null }).phone ?? null]));
  const extraDays = new Map<string, number>();
  for (const a of addenda ?? []) extraDays.set(a.contract_id, (extraDays.get(a.contract_id) ?? 0) + a.extra_days);
  const contractOf = new Map((contracts ?? []).map((c) => [c.id, c]));

  // --- payments (collections) -------------------------------------------------------
  const rows: PaymentRow[] = ((payments ?? []) as { id: string; contract_id: string; seq: number; label: string; amount: number; due_event: DueEvent; status: "pending" | "requested" | "paid"; requested_at: string | null; expected_date: string | null; paid_amount: number | null; paid_at: string | null; kind?: "schedule" | "measurement" }[]).map((p) => {
    const c = contractOf.get(p.contract_id)!;
    const amount = n(p.amount);
    const paid = n(p.paid_amount);
    const expected = expectedPaymentDate(p, { start_date: c.start_date, days: c.duration_days + (extraDays.get(c.id) ?? 0) }, today);
    return {
      id: p.id, contract_id: p.contract_id, contract: c.number, client: clientName.get(c.client_id) ?? "—", seq: p.seq, label: p.kind === "measurement" ? settlementLabel : p.label, amount, paid,
      outstanding: remainingAmount(amount, paid), status: p.status, requested_at: p.requested_at, expected, paid_at: p.paid_at,
      late: p.status === "requested" && !!p.requested_at && p.requested_at.slice(0, 10) <= addDays(today, -7),
      client_phone: clientPhone.get(c.client_id) ?? null, due_event: p.due_event,
      requestable: requestable.has(p.id),
    };
  });
  // addenda payments: requested on acceptance, a separate line each (money recorded by record_addendum_payment)
  for (const a of addenda ?? []) {
    const c = contractOf.get(a.contract_id);
    if (!c) continue;
    const total = n(a.total);
    // rows marked paid before amounts were recorded are paid in full (never a receivable again)
    const paid = addendumPaid({ payment_status: a.payment_status, paid_amount: n(a.paid_amount), total });
    const status = a.payment_status === "paid" ? "paid" : "requested";
    rows.push({
      id: `ad:${a.id}`, contract_id: a.contract_id, contract: c.number, client: clientName.get(c.client_id) ?? "—", seq: 99, label: `${ltr(a.number)} — ${a.title}`,
      amount: total, paid, outstanding: status === "paid" ? 0 : remainingAmount(total, paid), status, requested_at: a.accepted_at, expected: today, paid_at: a.paid_at ?? null,
      late: status === "requested" && !!a.accepted_at && a.accepted_at.slice(0, 10) <= addDays(today, -7),
      client_phone: clientPhone.get(c.client_id) ?? null,
    });
  }

  // --- outflows -----------------------------------------------------------------------
  const payday = settings?.payday ?? 27;
  const horizon = addDays(today, 12 * 7);
  const outflows: Flow[] = [];
  let payroll = 0;
  if (hr) {
    const [{ data: employees }, { data: items }, { runs, lines }] = hr;
    payroll = r2((employees ?? []).reduce((s, e) => s + n(e.basic_salary) + n(e.housing_allowance) + n(e.transport_allowance) + n(e.other_allowances), 0));
    // statutory items paid every month (GOSI %, monthly fees); provisions and annual / one-off items aren't monthly cash
    const monthlyItems: CostItem[] = cashStatutoryItems((items ?? []) as (CostItem & { is_provision: boolean })[]).map((i) => ({ ...i, value: n(i.value) }));
    const statutory = r2((employees ?? []).reduce((s, e) => s + employeeCost({ is_saudi: !!e.is_saudi, basic_salary: n(e.basic_salary), housing_allowance: n(e.housing_allowance), transport_allowance: n(e.transport_allowance), other_allowances: n(e.other_allowances) }, monthlyItems, 26).statutory.reduce((x, i) => x + i.monthly, 0), 0));
    // a month's payroll run: its net (after overtime, deductions and advances) replaces the gross
    const runNets = runs.map((r) => ({ month: r.month, status: r.status, net: lines.filter((l) => l.run_id === r.id).reduce((s, l) => s + n(l.net), 0) }));
    outflows.push(...payrollFlows(paydays(today, payday, horizon), runNets, payroll, statutory));
  }
  if (spend) {
    const [{ data: work }, { data: paid }, { data: pending }, { data: petty }] = spend;
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
  // a due reward is paid now; an expected one when its contract's last payment comes in (it becomes due then)
  for (const k of rewardRows) {
    if (k.status === "due") outflows.push({ date: today, amount: n(k.amount), label: "reward", kind: "reward" });
    if (k.status === "expected") {
      const own = rows.filter((r) => r.contract_id === k.contract_id && !r.id.startsWith("ad:"));
      const last = own.reduce((d, r) => (r.expected > d ? r.expected : d), today);
      if (own.length) outflows.push({ date: last, amount: n(k.amount), label: "reward", kind: "reward" });
    }
  }
  // money owed back to clients after a signed measurement (not paid back yet) — paid now
  const refunds = measureRows.filter((m) => !m.refunded_at).reduce((s, m) => s + n(m.credit_amount), 0);
  if (refunds > 0.005) outflows.push({ date: today, amount: r2(refunds), label: "refund", kind: "refund" });
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
  const costOf = new Map(costs.map((c) => [c.id, c]));
  let estimated = new Map<string, number>();
  if (estimatedTotals && versions?.length) {
    const [{ vid, total }, adCosts] = estimatedTotals;
    // accepted additional works add their own estimated cost (addendum_costs)
    const extra = new Map<string, number>();
    for (const a of adCosts ?? []) extra.set(a.contract_id, (extra.get(a.contract_id) ?? 0) + n(a.material_cost) + n(a.other_cost));
    // the partner's reward is part of the expected cost (the price carries it)
    for (const k of rewardRows) extra.set(k.contract_id, (extra.get(k.contract_id) ?? 0) + n(k.amount));
    estimated = new Map((contracts ?? []).map((c) => [c.id, (total.get(vid.find((v) => v.quote_id === c.quote_id && v.version === c.quote_version)?.id ?? "") ?? 0) + (extra.get(c.id) ?? 0)]).filter(([, v]) => (v as number) > 0) as [string, number][]);
  }
  const profits: ProfitRow[] = (contracts ?? []).map((c) => {
    const view = (versions as { quote_id: string; version: number; client_view: { vat?: number } }[] | null)?.find((v) => v.quote_id === c.quote_id && v.version === c.quote_version)?.client_view;
    const addRevenue = (addenda ?? []).filter((a) => a.contract_id === c.id).reduce((s, a) => s + n(a.amount), 0);
    const revenue = r2(n(c.total) - n(view?.vat) + addRevenue + (measured.get(c.id) ?? 0));
    const cost = costOf.get(c.id);
    // the same actual as the costs page: materials, expenses, petty cash, subcontractors and (with hr.view) our team
    const actualCost = r2(cost?.actual ?? 0);
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
    .map((c) => ({ number: c.number, client: c.client, ratio: costStatus(c.estimated, c.materialsActual).ratio ?? 0 }))
    .filter((c) => c.ratio > 1);

  // our team's fixed cost: how much of this month is charged to projects (the rest is covered by the overhead %)
  let teamCost: OwnerFinance["teamCost"] = null;
  const row = tc?.[0];
  if (row && n(row.monthly) > 0) teamCost = { monthly: n(row.monthly), allocated: n(row.allocated), toDate: n(row.to_date), unabsorbed: r2(Math.max(0, n(row.to_date) - n(row.allocated))) };
  return {
    today,
    orgName: session.organization.name,
    cash: { balance: opening, on: settings?.cash_balance_on ?? today, payday },
    kpis: {
      outstanding: r2([...byClient.values()].reduce((s, x) => s + x.outstanding, 0)),
      collectedMonth: r2((monthReceipts ?? []).reduce((s, r) => s + n(r.amount), 0)),
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
    approvals: (approvals ?? []).map(approvalRow),
    teamCost,
    labourHidden: can(session, "costs.view") && !can(session, "hr.view"),
    owedToClients: r2(refunds),
    rewards: rewardRows.length
      ? {
          due: r2(rewardRows.filter((k) => k.status === "due").reduce((s, k) => s + n(k.amount), 0)),
          dueCount: rewardRows.filter((k) => k.status === "due").length,
          expected: r2(rewardRows.filter((k) => k.status === "expected").reduce((s, k) => s + n(k.amount), 0)),
        }
      : null,
    canManage: can(session, "finance.manage"),
    canDecide: can(session, "approvals.decide"),
    links: { contracts: can(session, "quotes.view"), projects: can(session, "projects.view"), costs: can(session, "costs.view") && can(session, "purchases.view"), schedule: can(session, "schedule.view") },
  };
}
