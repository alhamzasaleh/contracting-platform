import "server-only";
import { aiConfigured } from "@/lib/ai/invoice";
import { can, type SessionContext } from "@/lib/auth/session";
import type { ServiceKind } from "@/lib/pricing";
import { once, rows } from "@/lib/data/query";
import { loadStaffNames } from "@/lib/data/staff";
import { createClient } from "@/lib/supabase/server";

const n = (v: unknown) => Number(v ?? 0);
/** area = the accepted quote's measured m² (pre-fills a new agreement) */
type ProjectRef = { id: string; number: string; client: string; area?: number };

async function projects(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, canSee: boolean): Promise<ProjectRef[]> {
  if (!canSee) return [];
  const [{ data: contracts }, { data: clients }] = await Promise.all([
    supabase.from("contracts").select("id, number, client_id, quote_id, quote_version").eq("organization_id", orgId).eq("status", "accepted").order("created_at", { ascending: false }),
    supabase.from("clients").select("id, name").eq("organization_id", orgId),
  ]);
  const names = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const quoteIds = [...new Set((contracts ?? []).map((c) => c.quote_id))];
  const { data: versions } = quoteIds.length
    ? await supabase.from("quote_versions").select("quote_id, version, client_view").eq("organization_id", orgId).in("quote_id", quoteIds)
    : { data: [] as { quote_id: string; version: number; client_view: unknown }[] };
  const areaOf = (quote: string, version: number) => {
    const v = (versions ?? []).find((x) => x.quote_id === quote && x.version === version)?.client_view as { workTypes?: { area?: number }[] } | null;
    const a = (v?.workTypes ?? []).reduce((s, w) => s + Number(w.area ?? 0), 0);
    return a > 0 ? Math.round(a * 100) / 100 : undefined;
  };
  return (contracts ?? []).map((c) => ({ id: c.id, number: c.number, client: names.get(c.client_id) ?? "—", area: areaOf(c.quote_id, c.quote_version) }));
}

export type SubAgreementView = {
  id: string; subcontractor_id: string; contract_id: string; scope: string; basis: "lump" | "per_m2"; rate: number; quantity_m2: number | null;
  schedule: "weekly" | "progress"; status: "active" | "closed";
  /** recorded automatically from project progress (progress schedule) */
  auto_progress: boolean;
  /** an accepted addendum (number) grew this project: review the agreement (any edit clears it) */
  review?: string | null;
  work: { id: string; work_date: string; quantity_m2: number | null; percent: number | null; amount: number; note: string | null; auto: boolean }[];
  payments: { id: string; paid_on: string; amount: number; method: string; reference: string | null }[];
};
export type SubcontractorsData = {
  subs: { id: string; name: string; phone: string | null; services: ServiceKind[]; iban: string | null; vat_number: string | null; notes: string | null; is_active: boolean }[];
  agreements: SubAgreementView[];
  projects: ProjectRef[];
  canManage: boolean;
  canPay: boolean;
  /** their prices on the pricing screen (costs.view only) */
  rates?: { subcontractor_id: string; basis: "external_per_unit" | "external_lump"; rate: number }[];
};

export async function loadSubcontractors(session: SessionContext): Promise<SubcontractorsData> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const agreementsP = once(supabase.from("subcontractor_agreements").select("id, subcontractor_id, contract_id, scope, basis, rate, quantity_m2, schedule, status, auto_progress, review_addendum_id").eq("organization_id", orgId).order("created_at", { ascending: false }));
  const [{ data: subs }, { data: agreements }, { data: work }, { data: payments }, projectList, reviewAds, rates] = await Promise.all([
    supabase.from("subcontractors").select("id, name, phone, services, iban, vat_number, notes, is_active").eq("organization_id", orgId).order("name"),
    agreementsP,
    supabase.from("subcontractor_work").select("id, agreement_id, work_date, quantity_m2, percent, amount, note, auto").eq("organization_id", orgId).order("work_date", { ascending: false }).limit(5000),
    supabase.from("subcontractor_payments").select("id, agreement_id, paid_on, amount, method, reference").eq("organization_id", orgId).order("paid_on", { ascending: false }).limit(5000),
    projects(supabase, orgId, can(session, "quotes.view")),
    // the addenda an agreement must be reviewed for (chained onto the agreements)
    agreementsP.then(({ data }) => {
      const reviewIds = [...new Set((data ?? []).map((g) => g.review_addendum_id).filter((x): x is string => !!x))];
      return reviewIds.length ? rows(supabase.from("addenda").select("id, number").in("id", reviewIds)) : [];
    }),
    can(session, "costs.view")
      ? rows(supabase.from("labour_rates").select("subcontractor_id, basis, rate").eq("organization_id", orgId).eq("is_active", true).not("subcontractor_id", "is", null))
      : Promise.resolve([]),
  ]);
  return {
    subs: subs ?? [],
    agreements: (agreements ?? []).map(({ review_addendum_id, ...g }) => ({
      ...g, review: review_addendum_id ? (reviewAds?.find((a) => a.id === review_addendum_id)?.number ?? null) : null, rate: n(g.rate), quantity_m2: g.quantity_m2 == null ? null : n(g.quantity_m2),
      work: (work ?? []).filter((w) => w.agreement_id === g.id).map((w) => ({ ...w, amount: n(w.amount), quantity_m2: w.quantity_m2 == null ? null : n(w.quantity_m2), percent: w.percent == null ? null : n(w.percent) })),
      payments: (payments ?? []).filter((p) => p.agreement_id === g.id).map((p) => ({ ...p, amount: n(p.amount) })),
    })),
    projects: projectList,
    canManage: can(session, "purchases.manage"),
    canPay: can(session, "finance.manage"),
    rates: (rates as { subcontractor_id: string; basis: "external_per_unit" | "external_lump"; rate: number }[]).map((r) => ({ ...r, rate: n(r.rate) })),
  };
}

export type PettyCashData = {
  accounts: { id: string; name: string; holder_id: string; holder: string; is_active: boolean }[];
  entries: { id: string; account_id: string; kind: "topup" | "expense" | "return"; entry_date: string; amount: number; contract_id: string | null; description: string; supplier_name: string | null; has_receipt: boolean; ai_extracted: boolean }[];
  members: { id: string; name: string }[];
  projects: ProjectRef[];
  userId: string;
  canFinance: boolean;
  canManage: boolean;
  aiEnabled: boolean;
};

export async function loadPettyCash(session: SessionContext): Promise<PettyCashData> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const membershipsP = once(supabase.from("memberships").select("user_id, status").eq("organization_id", orgId));
  const [{ data: accounts }, { data: entries }, { data: memberships }, projectList, name] = await Promise.all([
    supabase.from("petty_cash_accounts").select("id, name, holder_id, is_active").eq("organization_id", orgId).order("name"),
    supabase.from("petty_cash_entries").select("id, account_id, kind, entry_date, amount, contract_id, description, supplier_name, attachment_path, ai_extracted").eq("organization_id", orgId).order("entry_date", { ascending: false }).limit(2000),
    membershipsP,
    projects(supabase, orgId, can(session, "quotes.view") || can(session, "projects.view")),
    // every member's name (a suspended holder keeps his); linked employees: «name · job» (purchases.view) — no hr data
    membershipsP.then(({ data }) => loadStaffNames(supabase, orgId, (data ?? []).map((m) => m.user_id))),
  ]);
  // a new account goes to an active member only
  const ids = (memberships ?? []).filter((m) => m.status === "active").map((m) => m.user_id);
  return {
    accounts: (accounts ?? []).map((a) => ({ ...a, holder: name.get(a.holder_id) ?? "—" })),
    entries: (entries ?? []).map(({ attachment_path, ...e }) => ({ ...e, amount: n(e.amount), has_receipt: !!attachment_path })),
    members: ids.map((id) => ({ id, name: name.get(id) ?? "—" })),
    projects: projectList,
    userId: session.userId,
    canFinance: can(session, "finance.manage"),
    canManage: can(session, "purchases.manage"),
    aiEnabled: aiConfigured(),
  };
}
