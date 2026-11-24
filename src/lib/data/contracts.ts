import { termsSchema, type ContractTermsConfig } from "@/lib/contracts/terms";
import "server-only";
import { notFound } from "next/navigation";
import { can, type SessionContext } from "@/lib/auth/session";
import { defaultStages, suggestedDays, type DueEvent } from "@/lib/contracts";
import { loadPricingSettings } from "@/lib/data/catalogue";
import type { Line } from "@/lib/engine";
import type { ServiceKind } from "@/lib/pricing";
import type { ClientView } from "@/lib/quotes";
import { effectiveVatPercent } from "@/lib/costing";
import { lateDays } from "@/lib/finance";
import { bookingTeam } from "@/lib/schedule";
import type { AddendumStatus, ContractStatus } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

const n = (v: unknown) => Number(v ?? 0);
type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Material cost of a quote version (for the 75 % first-payment warning) — costs.view only. */
async function materialCost(supabase: Supabase, quoteId: string, version: number): Promise<number | null> {
  const { data: v } = await supabase.from("quote_versions").select("id").eq("quote_id", quoteId).eq("version", version).maybeSingle();
  if (!v) return null;
  const { data: c } = await supabase.from("quote_version_costs").select("lines").eq("quote_version_id", v.id).maybeSingle();
  if (!c) return null;
  return (c.lines as unknown as Line[]).filter((l) => l.group === "material").reduce((s, l) => s + l.cost, 0);
}

export type ContractListItem = { id: string; number: string; client: string; service: ServiceKind; status: ContractStatus; total: number; start_date: string; created_at: string };

export async function loadContracts(session: SessionContext): Promise<ContractListItem[]> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: contracts }, { data: clients }] = await Promise.all([
    supabase.from("contracts").select("id, number, client_id, service, status, total, start_date, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }),
    supabase.from("clients").select("id, name").eq("organization_id", orgId),
  ]);
  const name = new Map((clients ?? []).map((c) => [c.id, c.name]));
  return (contracts ?? []).map((c) => ({ ...c, client: name.get(c.client_id) ?? "—", total: n(c.total) }));
}

export type ContractDraft = {
  quote: { id: string; number: string; service: ServiceKind; version: number; total: number; projectType: "full" | "labour" | "supply" };
  client: { name: string };
  contract: { id: string; number: string; start_date: string; duration_days: number; warranty_months: number; notes: string | null } | null;
  payments: { label: string; percent: number; due_event: DueEvent }[];
  stages: DueEvent[];
  suggestedDays: number;
  defaultWarranty: number;
  materialCost: number | null;
  /** the team priced on the quote (G1) — the earliest-start suggestion uses it when known */
  bookTeam?: string | null;
};

/** Data for creating a contract from a quote, or editing a draft/sent one. */
export async function loadContractDraft(session: SessionContext, by: { quoteNumber?: string; contractNumber?: string }): Promise<ContractDraft> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  let contract: ContractDraft["contract"] = null;
  let payments: ContractDraft["payments"] = [];
  const quoteCols = "id, number, service, current_version, client_id";
  const settingsP = loadPricingSettings(session);
  settingsP.catch(() => {}); // awaited below; never an unhandled rejection if notFound() comes first
  let q: { id: string; number: string; service: ServiceKind; current_version: number; client_id: string } | null;
  if (by.contractNumber) {
    const { data: c } = await supabase.from("contracts").select("id, number, start_date, duration_days, warranty_months, notes, quote_id").eq("organization_id", orgId).eq("number", by.contractNumber).maybeSingle();
    if (!c) notFound();
    contract = { id: c.id, number: c.number, start_date: c.start_date, duration_days: c.duration_days, warranty_months: c.warranty_months, notes: c.notes };
    const [{ data: p }, { data: quote }] = await Promise.all([
      supabase.from("contract_payments").select("label, percent, due_event").eq("contract_id", c.id).order("seq"),
      supabase.from("quotes").select(quoteCols).eq("id", c.quote_id).maybeSingle(),
    ]);
    payments = (p ?? []).map((x) => ({ ...x, percent: n(x.percent) }));
    q = quote;
  } else {
    const { data: quote } = await supabase.from("quotes").select(quoteCols).eq("organization_id", orgId).eq("number", by.quoteNumber!).maybeSingle();
    q = quote;
  }
  if (!q) notFound();
  const verP = Promise.resolve(supabase.from("quote_versions").select("total, selection, client_view").eq("quote_id", q.id).eq("version", q.current_version).maybeSingle());
  const [{ data: ver }, { data: client }, settings, { data: rate }, materialCostValue, bookTeam] = await Promise.all([
    verP,
    supabase.from("clients").select("name").eq("id", q.client_id).maybeSingle(),
    settingsP,
    supabase.from("consumption_rates").select("value").eq("organization_id", orgId).eq("key", `${q.service}.productivity`).maybeSingle(),
    can(session, "costs.view") ? materialCost(supabase, q.id, q.current_version) : Promise.resolve(null),
    verP.then(({ data }) => loadBookingTeam(session, data?.selection)),
  ]);
  const view = ver?.client_view as unknown as ClientView | undefined;
  const area = (view?.workTypes ?? []).reduce((s, w) => s + w.area, 0);
  const stages = defaultStages(q.service).map((s) => s.key);
  return {
    quote: {
      id: q.id, number: q.number, service: q.service, version: q.current_version, total: n(ver?.total),
      projectType: ((ver?.selection as { options?: { projectType?: "full" | "labour" | "supply" } } | null)?.options?.projectType ?? "full"),
    },
    client: { name: client?.name ?? "—" },
    contract,
    payments,
    stages,
    suggestedDays: suggestedDays(area, n(rate?.value) || (q.service === "gypsum" ? 40 : q.service === "interior" ? 120 : 100)),
    defaultWarranty: Number(settings?.default_warranty_months ?? 6),
    materialCost: materialCostValue,
    bookTeam,
  };
}

export type ContractDetail = {
  contract: {
    id: string; number: string; status: ContractStatus; service: ServiceKind; project_type: "full" | "labour" | "supply";
    start_date: string; duration_days: number; warranty_months: number; total: number; notes: string | null; created_at: string;
    accepted_at: string | null; accepted_name: string | null; accepted_ip: string | null; accepted_user_agent: string | null; signed: boolean;
  };
  client: { number: string; name: string; phone: string | null; city: string | null; district: string | null; id_number: string | null };
  quote: { number: string; version: number; date: string; valid_until: string | null; view: ClientView; notes: string | null };
  payments: {
    seq: number; label: string; percent: number; amount: number; due_event: DueEvent; status: string;
    id?: string;
    /** received so far (record_client_payment) */
    paid_amount?: number;
    /** staff can ask the client for it now (public.requestable_payments: exactly what request_contract_payment accepts) */
    requestable?: boolean;
    /** requested 7+ days ago: days since the request (the WhatsApp reminder says it's late) */
    late_days?: number | null;
  }[];
  link: { active: boolean; expires_at: string | null; last_opened_at: string | null; open_count: number };
  materialCost: number | null;
  canManage: boolean;
  canPurchase: boolean;
  canViewProject: boolean;
  addenda: AddendumView[];
  canDecide: boolean;
  canFinance: boolean;
  /** VAT % applied to new addenda (0 without a company VAT number) */
  vatPercent: number;
  /** options offered to the client (the contract follows the one picked on acceptance) */
  options: { version: number; label: string; total: number }[] | null;
  /** Editable clauses of this contract, and the company template (for "copy from template"). */
  terms?: ContractTermsConfig;
  templateTerms?: ContractTermsConfig | null;
  /** Receipt vouchers issued for this contract (newest last) — finance.view (RLS). */
  receipts?: { number: string; label: string; amount: number; paid_on: string }[];
  /** Invoices issued for this contract — finance.view (RLS). */
  invoices?: { number: string; label: string; amount: number; paid_on: string }[];
  /** open maintenance requests (the warranty / maintenance page) */
  openMaintenance?: number;
  /** sees and enters estimated costs (costs.view) */
  canCosts?: boolean;
  /** the team chosen when pricing (in-house team, or the external rate's subcontractor team) — pre-selected when booking */
  bookTeam?: string | null;
  /** warranty end from the database (private.warranty_end) once handed over — closes the client page */
  warrantyEnd?: string | null;
  /** today in Riyadh (YYYY-MM-DD), so the view and the server agree */
  today?: string;
};

/**
 * G1: the team to book for a quote version's labour (the in-house team picked when pricing, or
 * the external rate's subcontractor team) — shared by the contract editor, contract and project pages.
 */
export async function loadBookingTeam(session: SessionContext, selection: unknown): Promise<string | null> {
  const labour = (selection as { labour?: { source: string; teamId?: string | null; externalId?: string | null } } | null | undefined)?.labour ?? null;
  if (!labour || labour.source === "rates" || !can(session, "schedule.view")) return null;
  const supabase = await createClient();
  const [{ data: teams }, { data: rates }] = await Promise.all([
    supabase.from("teams").select("id, subcontractor_id").eq("organization_id", session.organization.id).eq("is_active", true),
    labour.source === "external" && labour.externalId ? supabase.from("labour_rates").select("id, subcontractor_id").eq("id", labour.externalId) : Promise.resolve({ data: [] as { id: string; subcontractor_id: string | null }[] }),
  ]);
  return bookingTeam(labour, rates ?? [], teams ?? []);
}

/** The warranty end the database computes (handover + warranty months); null before handover or without projects.view. */
export async function loadWarrantyEnd(session: SessionContext, contractId: string): Promise<string | null> {
  if (!can(session, "projects.view")) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("contract_warranties", { p_org: session.organization.id });
  return (data ?? []).find((w) => w.contract_id === contractId)?.warranty_end ?? null;
}

export type AddendumView = {
  id: string; number: string; title: string; description: string; amount: number; vat: number; total: number; extra_days: number;
  status: AddendumStatus; payment_status: "pending" | "requested" | "paid"; accepted_at: string | null; accepted_name: string | null;
  approval_id: string | null; created_at: string;
  /** received so far (recorded only through record_addendum_payment) */
  paid_amount?: number;
  /** payment requested on acceptance 7+ days ago: days since then */
  late_days?: number | null;
  /** estimated cost (costs.view, addendum_costs) */
  cost?: { material: number; other: number } | null;
};

const parseTerms = (v: unknown): ContractTermsConfig => {
  const r = termsSchema.safeParse(v ?? {});
  return r.success ? r.data : {};
};

export async function loadContract(session: SessionContext, number: string): Promise<ContractDetail> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: c } = await supabase.from("contracts").select("*").eq("organization_id", orgId).eq("number", number).maybeSingle();
  if (!c) notFound();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  // everything below depends only on the contract row: one parallel round (chained where one query needs another's answer)
  // Promise.resolve: a query builder runs again on every .then(); a real promise runs it once and can be shared
  const verP = Promise.resolve(supabase.from("quote_versions").select("version, created_at, client_view, notes, selection").eq("quote_id", c.quote_id).eq("version", c.quote_version).maybeSingle());
  const addendaP = Promise.resolve(supabase.from("addenda").select("id, number, title, description, amount, vat, total, extra_days, status, payment_status, accepted_at, accepted_name, created_at, paid_amount").eq("contract_id", c.id).order("created_at"));
  const [
    { data: client }, { data: q }, { data: ver }, { data: payments }, { data: links },
    { data: addenda }, settings, { data: receipts }, { data: tpl }, { data: requestableRows },
    bookTeam, warrantyEnd, { data: invoices }, { count: openMaintenance },
    adCosts, approvals, { data: optRows }, materialCostValue,
  ] = await Promise.all([
    supabase.from("clients").select("number, name, phone, city, district, id_number").eq("id", c.client_id).maybeSingle(),
    supabase.from("quotes").select("number, valid_until").eq("id", c.quote_id).maybeSingle(),
    verP,
    supabase.from("contract_payments").select("id, seq, label, percent, amount, due_event, status, paid_amount, requested_at").eq("contract_id", c.id).order("seq"),
    supabase.from("client_portal_links").select("expires_at, revoked_at, last_opened_at, open_count").eq("contract_id", c.id).order("created_at", { ascending: false }),
    addendaP,
    loadPricingSettings(session),
    can(session, "finance.view") ? supabase.from("client_receipts").select("number, label, amount, paid_on").eq("contract_id", c.id).order("created_at") : Promise.resolve({ data: [] as { number: string; label: string; amount: number; paid_on: string }[] }),
    supabase.from("contract_templates").select("terms").eq("organization_id", orgId).maybeSingle(),
    // exactly what request_contract_payment accepts for this user (stages may be hidden from him)
    c.status === "accepted" ? supabase.rpc("requestable_payments", { p_org: orgId, p_contract: c.id }) : Promise.resolve({ data: [] as { payment_id: string }[] }),
    verP.then(({ data }) => loadBookingTeam(session, data?.selection)),
    c.status === "accepted" ? loadWarrantyEnd(session, c.id) : Promise.resolve(null),
    can(session, "finance.view")
      ? supabase.from("invoices").select("number, description, total, issue_date").eq("contract_id", c.id).order("issue_date").order("number")
      : Promise.resolve({ data: [] as { number: string; description: string; total: number; issue_date: string }[] }),
    c.status === "accepted" && can(session, "projects.view")
      ? supabase.from("maintenance_requests").select("id", { count: "exact", head: true }).eq("contract_id", c.id).in("status", ["open", "in_progress", "resolved"])
      : Promise.resolve({ count: 0 }),
    addendaP.then(async ({ data }) => {
      const adIds = (data ?? []).map((a) => a.id);
      return can(session, "costs.view") && adIds.length
        ? ((await supabase.from("addendum_costs").select("addendum_id, material_cost, other_cost").in("addendum_id", adIds)).data ?? [])
        : [];
    }),
    addendaP.then(async ({ data }) => {
      const pendingIds = (data ?? []).filter((a) => a.status === "pending_approval").map((a) => a.id);
      return pendingIds.length
        ? ((await supabase.from("approvals").select("id, entity_id").eq("entity", "addendum").eq("status", "pending").in("entity_id", pendingIds)).data ?? [])
        : [];
    }),
    c.options?.length
      ? supabase.from("quote_versions").select("version, total").eq("quote_id", c.quote_id).in("version", c.options.map((o) => o.version))
      : Promise.resolve({ data: [] as { version: number; total: number }[] }),
    can(session, "costs.view") ? materialCost(supabase, c.quote_id, c.quote_version) : Promise.resolve(null),
  ]);
  const active = (links ?? []).find((l) => !l.revoked_at && new Date(l.expires_at) > new Date());
  const requestable = new Set((requestableRows ?? []).map((r) => r.payment_id));
  return {
    options: c.options?.length ? c.options.map((o) => ({ ...o, total: n(optRows?.find((r) => r.version === o.version)?.total) })) : null,
    contract: {
      id: c.id, number: c.number, status: c.status, service: c.service, project_type: c.project_type, start_date: c.start_date,
      duration_days: c.duration_days, warranty_months: c.warranty_months, total: n(c.total), notes: c.notes, created_at: c.created_at,
      accepted_at: c.accepted_at, accepted_name: c.accepted_name, accepted_ip: c.accepted_ip, accepted_user_agent: c.accepted_user_agent,
      signed: !!c.accepted_signature,
    },
    client: client ?? { number: "", name: "—", phone: null, city: null, district: null, id_number: null },
    quote: { number: q?.number ?? "", version: c.quote_version, date: ver?.created_at ?? c.created_at, valid_until: q?.valid_until ?? null, view: ver?.client_view as unknown as ClientView, notes: ver?.notes ?? null },
    payments: (payments ?? []).map((p) => ({
      ...p, percent: n(p.percent), amount: n(p.amount), paid_amount: n(p.paid_amount),
      requestable: requestable.has(p.id),
      late_days: p.status === "requested" ? lateDays(p.requested_at, today) : null,
    })),
    link: { active: !!active, expires_at: active?.expires_at ?? null, last_opened_at: active?.last_opened_at ?? null, open_count: active?.open_count ?? 0 },
    materialCost: materialCostValue,
    canManage: can(session, "quotes.manage"),
    canPurchase: can(session, "purchases.manage"),
    canViewProject: can(session, "projects.view"),
    addenda: (addenda ?? []).map((a) => ({
      ...a, amount: n(a.amount), vat: n(a.vat), total: n(a.total), paid_amount: n(a.paid_amount), approval_id: (approvals ?? []).find((x) => x.entity_id === a.id)?.id ?? null,
      late_days: a.status === "accepted" && a.payment_status === "requested" ? lateDays(a.accepted_at, today) : null,
      cost: (() => {
        const k = (adCosts ?? []).find((x) => x.addendum_id === a.id);
        return k ? { material: n(k.material_cost), other: n(k.other_cost) } : null;
      })(),
    })),
    canCosts: can(session, "costs.view"),
    bookTeam,
    warrantyEnd,
    today,
    canDecide: can(session, "approvals.decide"),
    canFinance: can(session, "finance.manage"),
    terms: parseTerms(c.terms),
    templateTerms: tpl ? parseTerms(tpl.terms) : null,
    receipts: (receipts ?? []).map((r) => ({ number: r.number, label: r.label, amount: Number(r.amount), paid_on: r.paid_on })),
    invoices: (invoices ?? []).map((i) => ({ number: i.number, label: i.description, amount: Number(i.total), paid_on: i.issue_date })),
    openMaintenance: openMaintenance ?? 0,
    vatPercent: effectiveVatPercent(session.organization.vat_number, Number(settings?.vat_percent ?? 15)),
  };
}
