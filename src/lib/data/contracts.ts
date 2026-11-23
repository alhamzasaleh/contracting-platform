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
};

/** Data for creating a contract from a quote, or editing a draft/sent one. */
export async function loadContractDraft(session: SessionContext, by: { quoteNumber?: string; contractNumber?: string }): Promise<ContractDraft> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  let contract: ContractDraft["contract"] = null;
  let payments: ContractDraft["payments"] = [];
  let quoteId: string;
  if (by.contractNumber) {
    const { data: c } = await supabase.from("contracts").select("*").eq("organization_id", orgId).eq("number", by.contractNumber).maybeSingle();
    if (!c) notFound();
    contract = { id: c.id, number: c.number, start_date: c.start_date, duration_days: c.duration_days, warranty_months: c.warranty_months, notes: c.notes };
    quoteId = c.quote_id;
    const { data: p } = await supabase.from("contract_payments").select("label, percent, due_event").eq("contract_id", c.id).order("seq");
    payments = (p ?? []).map((x) => ({ ...x, percent: n(x.percent) }));
  } else {
    const { data: q } = await supabase.from("quotes").select("id").eq("organization_id", orgId).eq("number", by.quoteNumber!).maybeSingle();
    if (!q) notFound();
    quoteId = q.id;
  }
  const { data: q } = await supabase.from("quotes").select("id, number, service, current_version, client_id").eq("id", quoteId).maybeSingle();
  if (!q) notFound();
  const [{ data: ver }, { data: client }, settings] = await Promise.all([
    supabase.from("quote_versions").select("total, selection, client_view").eq("quote_id", q.id).eq("version", q.current_version).maybeSingle(),
    supabase.from("clients").select("name").eq("id", q.client_id).maybeSingle(),
    loadPricingSettings(session),
  ]);
  const view = ver?.client_view as unknown as ClientView | undefined;
  const area = (view?.workTypes ?? []).reduce((s, w) => s + w.area, 0);
  const { data: rate } = await supabase.from("consumption_rates").select("value").eq("organization_id", orgId).eq("key", `${q.service}.productivity`).maybeSingle();
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
    materialCost: can(session, "costs.view") ? await materialCost(supabase, q.id, q.current_version) : null,
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
  payments: { seq: number; label: string; percent: number; amount: number; due_event: DueEvent; status: string }[];
  link: { active: boolean; expires_at: string | null; last_opened_at: string | null; open_count: number };
  materialCost: number | null;
  canManage: boolean;
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
  /** Receipt vouchers issued for this contract (newest last). */
  receipts?: { number: string; label: string; amount: number; paid_on: string }[];
};

export type AddendumView = {
  id: string; number: string; title: string; description: string; amount: number; vat: number; total: number; extra_days: number;
  status: AddendumStatus; payment_status: "pending" | "requested" | "paid"; accepted_at: string | null; accepted_name: string | null;
  approval_id: string | null; created_at: string;
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
  const [{ data: client }, { data: q }, { data: ver }, { data: payments }, { data: links }] = await Promise.all([
    supabase.from("clients").select("number, name, phone, city, district, id_number").eq("id", c.client_id).maybeSingle(),
    supabase.from("quotes").select("number, valid_until").eq("id", c.quote_id).maybeSingle(),
    supabase.from("quote_versions").select("version, created_at, client_view, notes").eq("quote_id", c.quote_id).eq("version", c.quote_version).maybeSingle(),
    supabase.from("contract_payments").select("seq, label, percent, amount, due_event, status").eq("contract_id", c.id).order("seq"),
    supabase.from("client_portal_links").select("expires_at, revoked_at, last_opened_at, open_count").eq("contract_id", c.id).order("created_at", { ascending: false }),
  ]);
  const active = (links ?? []).find((l) => !l.revoked_at && new Date(l.expires_at) > new Date());
  const [{ data: addenda }, settings, { data: receipts }, { data: tpl }] = await Promise.all([
    supabase.from("addenda").select("id, number, title, description, amount, vat, total, extra_days, status, payment_status, accepted_at, accepted_name, created_at").eq("contract_id", c.id).order("created_at"),
    loadPricingSettings(session),
    supabase.from("client_receipts").select("number, label, amount, paid_on").eq("contract_id", c.id).order("created_at"),
    supabase.from("contract_templates").select("terms").eq("organization_id", orgId).maybeSingle(),
  ]);
  const pendingIds = (addenda ?? []).filter((a) => a.status === "pending_approval").map((a) => a.id);
  const { data: approvals } = pendingIds.length
    ? await supabase.from("approvals").select("id, entity_id").eq("entity", "addendum").eq("status", "pending").in("entity_id", pendingIds)
    : { data: [] as { id: string; entity_id: string }[] };
  const { data: optRows } = c.options?.length
    ? await supabase.from("quote_versions").select("version, total").eq("quote_id", c.quote_id).in("version", c.options.map((o) => o.version))
    : { data: [] as { version: number; total: number }[] };
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
    payments: (payments ?? []).map((p) => ({ ...p, percent: n(p.percent), amount: n(p.amount) })),
    link: { active: !!active, expires_at: active?.expires_at ?? null, last_opened_at: active?.last_opened_at ?? null, open_count: active?.open_count ?? 0 },
    materialCost: can(session, "costs.view") ? await materialCost(supabase, c.quote_id, c.quote_version) : null,
    canManage: can(session, "quotes.manage"),
    addenda: (addenda ?? []).map((a) => ({ ...a, amount: n(a.amount), vat: n(a.vat), total: n(a.total), approval_id: (approvals ?? []).find((x) => x.entity_id === a.id)?.id ?? null })),
    canDecide: can(session, "approvals.decide"),
    canFinance: can(session, "finance.manage"),
    terms: parseTerms(c.terms),
    templateTerms: tpl ? parseTerms(tpl.terms) : null,
    receipts: (receipts ?? []).map((r) => ({ number: r.number, label: r.label, amount: Number(r.amount), paid_on: r.paid_on })),
    vatPercent: effectiveVatPercent(session.organization.vat_number, Number(settings?.vat_percent ?? 15)),
  };
}
