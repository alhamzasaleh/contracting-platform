import "server-only";
import { notFound } from "next/navigation";
import { subStatement } from "@/lib/subcontractors/statement";
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
  payments: { id: string; number: string; paid_on: string; amount: number; method: string; reference: string | null }[];
};
export type SubcontractorsData = {
  subs: { id: string; number: string; name: string; phone: string | null; services: ServiceKind[]; iban: string | null; vat_number: string | null; notes: string | null; is_active: boolean }[];
  /** his page's open link (issued / valid until) — the token is shown only once (purchases.manage) */
  links?: { subcontractor_id: string; created_at: string; expires_at: string }[];
  /** finance.view: opens the payment vouchers */
  canSeeVouchers?: boolean;
  /** the viewer sees every project (owner or project scope «all»): totals are his whole account and his page link can be issued */
  allProjects?: boolean;
  /** project links: /contracts (quotes.view) else /projects (projects.view) else text */
  projectLinks?: { contracts: boolean; projects: boolean };
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
  const agreementsP = once(supabase.from("subcontractor_agreements").select("id, subcontractor_id, contract_id, scope, basis, rate, quantity_m2, schedule, status, auto_progress, review_addendum_id, review_measurement_id").eq("organization_id", orgId).order("created_at", { ascending: false }));
  const [{ data: subs }, { data: agreements }, { data: work }, { data: payments }, projectList, reviewAds, rates, links, { data: me }] = await Promise.all([
    supabase.from("subcontractors").select("id, number, name, phone, services, iban, vat_number, notes, is_active").eq("organization_id", orgId).order("name"),
    agreementsP,
    supabase.from("subcontractor_work").select("id, agreement_id, work_date, quantity_m2, percent, amount, note, auto").eq("organization_id", orgId).order("work_date", { ascending: false }).limit(5000),
    supabase.from("subcontractor_payments").select("id, number, agreement_id, paid_on, amount, method, reference").eq("organization_id", orgId).order("paid_on", { ascending: false }).limit(5000),
    projects(supabase, orgId, can(session, "quotes.view")),
    // the addenda an agreement must be reviewed for (chained onto the agreements)
    agreementsP.then(({ data }) => {
      const reviewIds = [...new Set((data ?? []).map((g) => g.review_addendum_id).filter((x): x is string => !!x))];
      const sheetIds = [...new Set((data ?? []).map((g) => g.review_measurement_id).filter((x): x is string => !!x))];
      // an accepted addendum or a signed measurement sheet: either may change the quantity
      return Promise.all([
        reviewIds.length ? rows(supabase.from("addenda").select("id, number").in("id", reviewIds)) : [],
        sheetIds.length ? rows(supabase.from("contract_measurements").select("id, number").in("id", sheetIds)) : [],
      ]).then(([a, m]) => [...a, ...m]);
    }),
    can(session, "costs.view")
      ? rows(supabase.from("labour_rates").select("subcontractor_id, basis, rate").eq("organization_id", orgId).eq("is_active", true).not("subcontractor_id", "is", null))
      : Promise.resolve([]),
    can(session, "purchases.manage")
      ? rows(supabase.from("subcontractor_portal_links").select("subcontractor_id, created_at, expires_at").eq("organization_id", orgId).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }))
      : Promise.resolve([] as { subcontractor_id: string; created_at: string; expires_at: string }[]),
    supabase.from("memberships").select("project_scope").eq("organization_id", orgId).eq("user_id", session.userId).maybeSingle(),
  ]);
  return {
    subs: subs ?? [],
    links,
    allProjects: session.role === "owner" || (me?.project_scope ?? "all") === "all",
    projectLinks: { contracts: can(session, "quotes.view"), projects: can(session, "projects.view") },
    canSeeVouchers: can(session, "finance.view"),
    agreements: (agreements ?? []).map(({ review_addendum_id, review_measurement_id, ...g }) => ({
      ...g, review: review_addendum_id || review_measurement_id ? (reviewAds?.find((a) => a.id === (review_addendum_id ?? review_measurement_id))?.number ?? null) : null, rate: n(g.rate), quantity_m2: g.quantity_m2 == null ? null : n(g.quantity_m2),
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

export type SubStatementDoc = {
  sub: { number: string; name: string; phone: string | null; iban: string | null; vat_number: string | null };
  statement: ReturnType<typeof subStatement>;
  agreements: { contract: string; client: string; scope: string; agreed: number; earned: number; paid: number }[];
  today: string;
};

/** A subcontractor's statement of account (purchases.view — the subcontractors page's guard; RLS). */
export async function loadSubStatement(session: SessionContext, number: string): Promise<SubStatementDoc> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: s } = await supabase.from("subcontractors").select("id, number, name, phone, iban, vat_number").eq("organization_id", orgId).eq("number", number).maybeSingle();
  if (!s) notFound();
  const { data: ags } = await supabase.from("subcontractor_agreements").select("id, contract_id, scope, basis, rate, quantity_m2").eq("subcontractor_id", s.id).order("created_at");
  const ids = (ags ?? []).map((g) => g.id);
  const cids = [...new Set((ags ?? []).map((g) => g.contract_id))];
  const [{ data: work }, { data: pays }, { data: cons }] = await Promise.all([
    ids.length ? supabase.from("subcontractor_work").select("agreement_id, work_date, quantity_m2, percent, amount, note").in("agreement_id", ids) : Promise.resolve({ data: [] as never[] }),
    ids.length ? supabase.from("subcontractor_payments").select("agreement_id, number, paid_on, amount, method").in("agreement_id", ids) : Promise.resolve({ data: [] as never[] }),
    cids.length ? supabase.from("contracts").select("id, number, client_id").in("id", cids) : Promise.resolve({ data: [] as { id: string; number: string; client_id: string }[] }),
  ]);
  const clientIds = [...new Set((cons ?? []).map((c) => c.client_id))];
  const { data: clients } = clientIds.length ? await supabase.from("clients").select("id, name").in("id", clientIds) : { data: [] as { id: string; name: string }[] };
  const con = new Map((cons ?? []).map((c) => [c.id, c]));
  const cname = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const refs = (ags ?? []).map((g) => {
    const c = con.get(g.contract_id);
    return { id: g.id, contract: c?.number ?? "—", client: (c && cname.get(c.client_id)) ?? "—", scope: g.scope };
  });
  const w = (work ?? []).map((x) => ({ ...x, amount: n(x.amount), quantity_m2: x.quantity_m2 == null ? null : n(x.quantity_m2), percent: x.percent == null ? null : n(x.percent) }));
  const p = (pays ?? []).map((x) => ({ ...x, amount: n(x.amount) }));
  return {
    sub: { number: s.number, name: s.name, phone: s.phone, iban: s.iban, vat_number: s.vat_number },
    statement: subStatement(refs, w, p),
    agreements: (ags ?? []).map((g, i) => ({
      contract: refs[i].contract, client: refs[i].client, scope: g.scope,
      agreed: Math.round((g.basis === "lump" ? n(g.rate) : n(g.rate) * n(g.quantity_m2)) * 100) / 100,
      earned: Math.round(w.filter((x) => x.agreement_id === g.id).reduce((a, x) => a + x.amount, 0) * 100) / 100,
      paid: Math.round(p.filter((x) => x.agreement_id === g.id).reduce((a, x) => a + x.amount, 0) * 100) / 100,
    })),
    today: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }),
  };
}

export type SubVoucherDoc = {
  voucher: { number: string; paid_on: string; amount: number; method: string; reference: string | null; note: string | null };
  sub: { number: string; name: string; iban: string | null };
  agreement: { contract: string; client: string; scope: string };
};

/** One subcontractor payment voucher (SP-) — finance.view (money documents) + RLS. */
export async function loadSubVoucher(session: SessionContext, number: string): Promise<SubVoucherDoc> {
  const supabase = await createClient();
  const { data: p } = await supabase.from("subcontractor_payments").select("number, paid_on, amount, method, reference, note, agreement_id").eq("organization_id", session.organization.id).eq("number", number).maybeSingle();
  if (!p) notFound();
  const { data: g } = await supabase.from("subcontractor_agreements").select("subcontractor_id, contract_id, scope").eq("id", p.agreement_id).maybeSingle();
  const [{ data: s }, { data: c }] = await Promise.all([
    g ? supabase.from("subcontractors").select("number, name, iban").eq("id", g.subcontractor_id).maybeSingle() : Promise.resolve({ data: null }),
    g ? supabase.from("contracts").select("number, client_id").eq("id", g.contract_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const { data: cl } = c ? await supabase.from("clients").select("name").eq("id", c.client_id).maybeSingle() : { data: null };
  return {
    voucher: { number: p.number, paid_on: p.paid_on, amount: n(p.amount), method: p.method, reference: p.reference, note: p.note },
    sub: { number: s?.number ?? "—", name: s?.name ?? "—", iban: s?.iban ?? null },
    agreement: { contract: c?.number ?? "—", client: cl?.name ?? "—", scope: g?.scope ?? "" },
  };
}
