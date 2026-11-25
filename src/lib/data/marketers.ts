import "server-only";
import { notFound } from "next/navigation";
import { can, type SessionContext } from "@/lib/auth/session";
import type { CommissionStatus } from "@/lib/marketers";
import { rows } from "@/lib/data/query";
import { createClient } from "@/lib/supabase/server";

const n = (v: unknown) => Number(v ?? 0);
type Supa = Awaited<ReturnType<typeof createClient>>;

/** A success partner as a pick-list entry (no phone / IBAN; the % only with costs.view or marketers.manage). */
export type MarketerChoice = { id: string; number: string; name: string; is_active: boolean; commission_percent: number | null };

export async function loadMarketerChoices(supabase: Supa, orgId: string): Promise<MarketerChoice[]> {
  const list = await rows(supabase.rpc("marketer_choices", { p_org: orgId }));
  return list.map((m) => ({ ...m, commission_percent: m.commission_percent == null ? null : n(m.commission_percent) }));
}

export type CommissionView = {
  id: string; contract_id: string; contract: string; client: string; marketer_id: string; base: number; percent: number; amount: number;
  status: CommissionStatus; due_at: string | null; paid_at: string | null; created_at: string;
  voucher: { number: string; paid_on: string; method: string; reference: string | null } | null;
};
export type MarketerView = {
  id: string; number: string; name: string; phone: string | null; commission_percent: number; iban: string | null; notes: string | null; is_active: boolean;
  clients: { number: string; name: string }[];
  /** the open page link (issued when / valid until) — the token itself is shown only once */
  link: { created_at: string; expires_at: string } | null;
};
export type MarketersData = {
  marketers: MarketerView[];
  commissions: CommissionView[];
  canManage: boolean;
  canPay: boolean;
  /** the voucher print page needs finance.view */
  canSeeVouchers: boolean;
  /** contract links: /contracts (quotes.view) else /projects (projects.view) else text */
  links: { contracts: boolean; projects: boolean };
  orgName: string;
};

export async function loadMarketers(session: SessionContext): Promise<MarketersData> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const canManage = can(session, "marketers.manage");
  const [marketers, commissions, payments, clients, contracts, links] = await Promise.all([
    rows(supabase.from("marketers").select("id, number, name, phone, commission_percent, iban, notes, is_active").eq("organization_id", orgId).order("is_active", { ascending: false }).order("name")),
    rows(supabase.from("marketer_commissions").select("id, contract_id, marketer_id, base, percent, amount, status, due_at, paid_at, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(5000)),
    rows(supabase.from("commission_payments").select("commission_id, number, paid_on, method, reference").eq("organization_id", orgId).limit(5000)),
    rows(supabase.from("clients").select("id, number, name, marketer_id").eq("organization_id", orgId).not("marketer_id", "is", null)),
    rows(supabase.from("contracts").select("id, number, client_id").eq("organization_id", orgId).not("marketer_id", "is", null)),
    canManage
      ? rows(supabase.from("marketer_portal_links").select("marketer_id, created_at, expires_at").eq("organization_id", orgId).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }))
      : Promise.resolve([] as { marketer_id: string; created_at: string; expires_at: string }[]),
  ]);
  // client names of contracts the viewer can see (clients RLS); names of the others come from the contract's client
  const allClients = contracts.length ? await rows(supabase.from("clients").select("id, name").in("id", [...new Set(contracts.map((c) => c.client_id))])) : [];
  const clientName = new Map(allClients.map((c) => [c.id, c.name]));
  const contractOf = new Map(contracts.map((c) => [c.id, c]));
  const voucherOf = new Map(payments.map((p) => [p.commission_id, p]));
  return {
    marketers: marketers.map((m) => ({
      ...m,
      commission_percent: n(m.commission_percent),
      clients: clients.filter((c) => c.marketer_id === m.id).map((c) => ({ number: c.number, name: c.name })),
      link: links.find((l) => l.marketer_id === m.id) ?? null,
    })),
    commissions: commissions.map((k) => {
      const c = contractOf.get(k.contract_id);
      const v = voucherOf.get(k.id);
      return {
        ...k, base: n(k.base), percent: n(k.percent), amount: n(k.amount), status: k.status as CommissionStatus,
        contract: c?.number ?? "—", client: (c && clientName.get(c.client_id)) ?? "—",
        voucher: v ? { number: v.number, paid_on: v.paid_on, method: v.method, reference: v.reference } : null,
      };
    }),
    canManage,
    canPay: can(session, "finance.manage"),
    canSeeVouchers: can(session, "finance.view"),
    links: { contracts: can(session, "quotes.view"), projects: can(session, "projects.view") },
    orgName: session.organization.name,
  };
}

/** The reward of one contract (costs.view / finance.view / marketers.manage — RLS), for the contract and project pages. */
export type ContractCommission = {
  id: string | null; marketer: string; percent: number; amount: number; status: CommissionStatus; voucher: string | null;
  /** links shown only to who may open them: /partners (marketers.manage or finance.view), the voucher print page (finance.view) */
  canOpenPartners?: boolean; canOpenVoucher?: boolean;
} | null;
const partnerLinks = (session: SessionContext) => ({
  canOpenPartners: can(session, "marketers.manage") || can(session, "finance.view"),
  canOpenVoucher: can(session, "finance.view"),
});
export async function loadContractCommission(session: SessionContext, contractId: string): Promise<ContractCommission> {
  if (!can(session, "costs.view") && !can(session, "finance.view") && !can(session, "marketers.manage")) return null;
  const supabase = await createClient();
  const { data: k } = await supabase.from("marketer_commissions").select("id, marketer_id, percent, amount, status").eq("contract_id", contractId).maybeSingle();
  if (!k) {
    // not accepted yet: the agreed version's frozen reward (costs.view — quote_version_costs RLS)
    if (!can(session, "costs.view")) return null;
    const { data: c } = await supabase.from("contracts").select("quote_id, quote_version, status").eq("id", contractId).maybeSingle();
    if (!c || c.status === "accepted" || c.status === "cancelled") return null;
    const { data: v } = await supabase.from("quote_versions").select("id").eq("quote_id", c.quote_id).eq("version", c.quote_version).maybeSingle();
    const { data: qc } = v ? await supabase.from("quote_version_costs").select("marketer_id, commission_percent, commission_amount").eq("quote_version_id", v.id).maybeSingle() : { data: null };
    if (!qc?.marketer_id || !(n(qc.commission_percent) > 0)) return null;
    const choices = await loadMarketerChoices(supabase, session.organization.id);
    return { id: null, marketer: choices.find((m) => m.id === qc.marketer_id)?.name ?? "—", percent: n(qc.commission_percent), amount: n(qc.commission_amount), status: "expected", voucher: null, ...partnerLinks(session) };
  }
  const [choices, { data: v }] = await Promise.all([
    loadMarketerChoices(supabase, session.organization.id),
    supabase.from("commission_payments").select("number").eq("commission_id", k.id).maybeSingle(),
  ]);
  return { id: k.id, marketer: choices.find((m) => m.id === k.marketer_id)?.name ?? "—", percent: n(k.percent), amount: n(k.amount), status: k.status as CommissionStatus, voucher: v?.number ?? null, ...partnerLinks(session) };
}

export type PaymentVoucherDoc = {
  org: { name: string; legal_name: string | null; cr_number: string | null; vat_number: string | null; phone: string | null; city: string | null; address: string | null; signatory_name: string | null; signatory_title: string | null; logoUrl?: string | null };
  voucher: { number: string; paid_on: string; amount: number; method: string; reference: string | null; note: string | null };
  marketer: { number: string; name: string; iban: string | null };
  contract: { number: string; client: string; base: number; percent: number };
};

/** One payment voucher (PV-) — finance.view (the print page's guard) + RLS. */
export async function loadPaymentVoucher(session: SessionContext, number: string): Promise<PaymentVoucherDoc> {
  const supabase = await createClient();
  const { data: p } = await supabase.from("commission_payments").select("number, paid_on, amount, method, reference, note, commission_id, marketer_id, contract_id").eq("organization_id", session.organization.id).eq("number", number).maybeSingle();
  if (!p) notFound();
  const [{ data: k }, { data: c }, { data: m }, choices] = await Promise.all([
    supabase.from("marketer_commissions").select("base, percent").eq("id", p.commission_id).maybeSingle(),
    supabase.from("contracts").select("number, client_id").eq("id", p.contract_id).maybeSingle(),
    supabase.from("marketers").select("number, name, iban").eq("id", p.marketer_id).maybeSingle(),
    loadMarketerChoices(supabase, session.organization.id),
  ]);
  const { data: cl } = c ? await supabase.from("clients").select("name").eq("id", c.client_id).maybeSingle() : { data: null };
  const choice = choices.find((x) => x.id === p.marketer_id);
  const o = session.organization;
  return {
    org: { name: o.name, legal_name: o.legal_name, cr_number: o.cr_number, vat_number: o.vat_number, phone: o.phone, city: o.city, address: o.address, signatory_name: o.signatory_name, signatory_title: o.signatory_title },
    voucher: { number: p.number, paid_on: p.paid_on, amount: n(p.amount), method: p.method, reference: p.reference, note: p.note },
    marketer: { number: m?.number ?? choice?.number ?? "—", name: m?.name ?? choice?.name ?? "—", iban: m?.iban ?? null },
    contract: { number: c?.number ?? "—", client: cl?.name ?? "—", base: n(k?.base), percent: n(k?.percent) },
  };
}
