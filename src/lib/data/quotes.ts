import "server-only";
import { loadMarketerChoices } from "@/lib/data/marketers";
import { notFound } from "next/navigation";
import { can, type SessionContext } from "@/lib/auth/session";
import { loadPricingContext } from "@/lib/data/pricing";
import type { Quantities, Selection, ServiceKind } from "@/lib/pricing";
import type { ClientView, PurchaseItem } from "@/lib/quotes";
import type { QuoteStatus } from "@/lib/supabase/database.types";
import { rows } from "@/lib/data/query";
import { createClient } from "@/lib/supabase/server";
import { surveyGaps, surveyQuantities, type SurveyRoom, type SurveyTotals } from "@/lib/survey";
import type { Line } from "@/lib/engine";
import { pastStats, type PastStats } from "@/lib/pricing/history";
import { quoteOutcome, quotesWaiting, type QuoteDecision, type QuoteWaiting } from "@/lib/portal-flow";

const n = (v: unknown) => Number(v ?? 0);

export type QuoteListItem = {
  id: string;
  number: string;
  client: string;
  clientNumber: string;
  service: ServiceKind;
  status: QuoteStatus;
  version: number;
  total: number | null;
  created_at: string;
  /** the client's answer on his page */
  clientDecision?: QuoteDecision | null;
};

export async function loadQuotes(session: SessionContext): Promise<QuoteListItem[]> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: quotes }, { data: clients }, { data: versions }] = await Promise.all([
    supabase.from("quotes").select("id, number, client_id, service, status, current_version, created_at, client_decision").eq("organization_id", orgId).order("created_at", { ascending: false }),
    supabase.from("clients").select("id, name, number").eq("organization_id", orgId),
    supabase.from("quote_versions").select("quote_id, version, total").eq("organization_id", orgId),
  ]);
  const client = new Map((clients ?? []).map((c) => [c.id, c]));
  return (quotes ?? []).map((q) => ({
    id: q.id,
    number: q.number,
    client: client.get(q.client_id)?.name ?? "—",
    clientNumber: client.get(q.client_id)?.number ?? "",
    service: q.service,
    status: q.status,
    clientDecision: q.client_decision ?? null,
    version: q.current_version,
    total: (() => {
      const v = (versions ?? []).find((x) => x.quote_id === q.id && x.version === q.current_version);
      return v ? n(v.total) : null;
    })(),
    created_at: q.created_at,
  }));
}

async function surveySource(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, by: { id?: string; number?: string }, kind: ServiceKind) {
  let query = supabase.from("surveys").select("id, number, title, mode, totals, client_id").eq("organization_id", orgId);
  query = by.id ? query.eq("id", by.id) : query.eq("number", by.number!);
  const { data: survey } = await query.maybeSingle();
  if (!survey) return null;
  const [{ data: rooms }, { data: client }] = await Promise.all([
    supabase.from("survey_rooms").select("*").eq("survey_id", survey.id).order("sort_order"),
    supabase.from("clients").select("id, number, name, phone, city").eq("id", survey.client_id).maybeSingle(),
  ]);
  const list: SurveyRoom[] = (rooms ?? []).map((r) => ({
    id: r.id, name: r.name, unit_label: r.unit_label, length_m: n(r.length_m), width_m: n(r.width_m), height_m: n(r.height_m),
    openings_m2: n(r.openings_m2), gypsum_ceiling: r.gypsum_ceiling, ceiling_board: r.ceiling_board, paint_walls: r.paint_walls,
    paint_ceiling: r.paint_ceiling, wall_zone: r.wall_zone,
  }));
  const q = surveyQuantities(kind, survey.mode, list, (survey.totals ?? {}) as SurveyTotals);
  return { survey: { id: survey.id, number: survey.number, title: survey.title, mode: survey.mode }, client: client!, quantities: q, gaps: surveyGaps(kind, q) };
}

/** Data for the quote editor (new quote from a survey, or a new version of a quote). */
export async function loadQuoteEditor(session: SessionContext, args: { surveyNumber?: string; service?: ServiceKind; quoteNumber?: string }) {
  const supabase = await createClient();
  const orgId = session.organization.id;
  // the pricing context doesn't depend on the quote: start it now, alongside the quote lookups
  const contextP = loadPricingContext(session);
  contextP.catch(() => {}); // awaited below; never an unhandled rejection if notFound() comes first
  let quote: { id: string; number: string; service: ServiceKind; survey_id: string | null; current_version: number; marketer_id?: string | null } | null = null;
  let initial: Selection | null = null;
  let discount = 0;
  let method: "unit" | "lump" = "unit";
  let notes: string | null = null;
  if (args.quoteNumber) {
    const { data } = await supabase.from("quotes").select("id, number, service, survey_id, current_version, marketer_id").eq("organization_id", orgId).eq("number", args.quoteNumber).maybeSingle();
    if (!data || !data.survey_id) notFound();
    quote = data;
  }
  const kind = (quote?.service ?? args.service)!;
  const [v, src, [{ ctx, templates, canSeeCrewCost }, history]] = await Promise.all([
    quote ? supabase.from("quote_versions").select("selection, discount, client_view, pricing_method, notes").eq("quote_id", quote.id).eq("version", quote.current_version).maybeSingle().then((r) => r.data) : Promise.resolve(null),
    surveySource(supabase, orgId, quote ? { id: quote.survey_id! } : { number: args.surveyNumber }, kind),
    Promise.all([contextP, loadPastStats(session, kind, quote?.id ?? null)]),
  ]);
  if (!src) notFound();
  // the success partner: the quote's own (as last priced), else the client's «جاء عن طريق» (owner may change / remove it)
  const [partners, clientRow] = await Promise.all([
    loadMarketerChoices(supabase, orgId),
    quote ? Promise.resolve(null) : supabase.from("clients").select("marketer_id").eq("organization_id", orgId).eq("number", src.client.number).maybeSingle().then((r) => r.data),
  ]);
  const partnerId = quote ? (quote.marketer_id ?? null) : (clientRow?.marketer_id ?? null);
  if (v) {
    initial = v.selection as unknown as Selection;
    discount = n((v.client_view as { discountPercent?: number } | null)?.discountPercent ?? 0);
    method = v.pricing_method;
    notes = v.notes;
  }
  return { quote, kind, initial, discount, method, notes, ...src, ctx, templates, canSeeCrewCost, history, partners, partnerId };
}

/**
 * The company's past quotes for this service (costs.view): won = the client accepted
 * the contract; lost = declined by the client (his page) / rejected / expired, or issued more
 * than 30 days ago with no contract (`quoteOutcome()`).
 */
export async function loadPastStats(session: SessionContext, kind: ServiceKind, exclude: string | null): Promise<PastStats | null> {
  if (!can(session, "costs.view")) return null;
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: qs } = await supabase
    .from("quotes")
    .select("id, status, current_version, valid_until, updated_at, client_decision")
    .eq("organization_id", orgId)
    .eq("service", kind)
    .in("status", ["issued", "accepted", "rejected", "expired"])
    .order("created_at", { ascending: false })
    .limit(200);
  const list = (qs ?? []).filter((q) => q.id !== exclude);
  if (!list.length) return pastStats([], 0);
  const ids = list.map((q) => q.id);
  const [{ data: contracts }, { data: versions }, { data: settings }] = await Promise.all([
    supabase.from("contracts").select("id, quote_id, quote_version, status, start_date, duration_days").in("quote_id", ids).neq("status", "cancelled"),
    supabase.from("quote_versions").select("id, quote_id, version, client_view").in("quote_id", ids),
    supabase.from("pricing_settings").select("min_margin_percent").eq("organization_id", orgId).maybeSingle(),
  ]);
  const accepted = (contracts ?? []).filter((c) => c.status === "accepted");
  // the final stages (actual duration) are needed only at the end: fetched alongside the margins below
  const finalsP = accepted.length
    ? rows(supabase.from("project_stages").select("contract_id, confirmed_at").eq("is_final", true).eq("status", "confirmed").in("contract_id", accepted.map((c) => c.id)))
    : Promise.resolve([] as { contract_id: string; confirmed_at: string | null }[]);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const picked = list
    .map((q) => {
      const c = (contracts ?? []).find((x) => x.quote_id === q.id);
      const outcome = quoteOutcome(q, c ?? null, monthAgo);
      if (!outcome) return null;
      const won = outcome === "won";
      const version = won && c ? c.quote_version : q.current_version;
      const v = (versions ?? []).find((x) => x.quote_id === q.id && x.version === version);
      if (!v) return null;
      return { q, v, c, outcome, plannedDays: c?.duration_days ?? null };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const [costs, finals] = await Promise.all([
    picked.length ? rows(supabase.from("quote_version_costs").select("quote_version_id, margin_percent").in("quote_version_id", picked.map((p) => p.v.id))) : Promise.resolve([] as { quote_version_id: string; margin_percent: number }[]),
    finalsP,
  ]);
  const actualDaysOf = (c: { id: string; start_date: string } | undefined) => {
    const fin = c ? finals.find((f) => f.contract_id === c.id)?.confirmed_at : null;
    return c && fin ? Math.max(1, Math.round((Date.parse(fin) - Date.parse(c.start_date)) / 86_400_000)) : null;
  };
  const margin = new Map(costs.map((c) => [c.quote_version_id, n(c.margin_percent)]));
  return pastStats(
    picked
      .filter((p) => margin.has(p.v.id))
      .map((p) => ({
        outcome: p.outcome,
        margin: margin.get(p.v.id)!,
        workTypes: ((p.v.client_view as unknown as ClientView | null)?.workTypes ?? []).map((w) => ({ workType: w.workType, pricePerM2: n(w.pricePerM2) })),
        plannedDays: p.plannedDays,
        actualDays: actualDaysOf(p.c),
      })),
    n(settings?.min_margin_percent ?? 20),
  );
}

export type QuoteDetail = {
  quote: { id: string; number: string; service: ServiceKind; status: QuoteStatus; version: number; valid_until: string | null; created_at: string };
  client: { number: string; name: string; phone: string | null; city: string | null };
  survey: { number: string } | null;
  current: { version: number; clientView: ClientView; notes: string | null; estimated: boolean; created_at: string; quantities: Quantities } | null;
  versions: { version: number; total: number; created_at: string; brands: string[] }[];
  /** 2–3 versions offered side by side (null = a single quote) */
  options: { version: number; label: string }[] | null;
  /** reward = the success partner's frozen reward on this version (internal) */
  internal: { cost: number; costWithContingency: number; marginPercent: number; lines: Line[]; purchaseList: PurchaseItem[]; reward?: { name: string; percent: number; amount: number } | null } | null;
  approvals: { id: string; kind: string; status: string; details: Record<string, unknown>; decided_at: string | null; decision_note: string | null }[];
  canManage: boolean;
  /** may record purchases (purchases.manage) — «create a purchase» from the list once the contract is accepted */
  canPurchase?: boolean;
  canDecide: boolean;
  contract: { number: string; status: string } | null;
  /** the client's answer on his page (one link for every stage) */
  clientDecision?: { decision: QuoteDecision; at: string; name: string | null; note: string | null; version: number | null; ip: string | null } | null;
  /** the quote's client-page link (issued from the quote; then it follows the contract made from it) */
  link?: { active: boolean; expires_at: string | null; open_count: number; last_opened_at: string | null; onContract: boolean };
  /** the owner may delete it (public.delete_quote); anyContract = a contract of any status, cancelled included */
  canDelete?: boolean;
  anyContract?: boolean;
};

export async function loadQuote(session: SessionContext, number: string): Promise<QuoteDetail> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: q } = await supabase.from("quotes").select("*").eq("organization_id", orgId).eq("number", number).maybeSingle();
  if (!q) notFound();
  const owner = session.role === "owner";
  const [{ data: client }, { data: survey }, { data: versions }, { data: approvals }, { data: contract }, { data: links }, allContracts] = await Promise.all([
    supabase.from("clients").select("number, name, phone, city").eq("id", q.client_id).maybeSingle(),
    q.survey_id ? supabase.from("surveys").select("number").eq("id", q.survey_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("quote_versions").select("id, version, total, created_at, client_view, notes, estimated, quantities").eq("quote_id", q.id).order("version", { ascending: false }),
    supabase.from("approvals").select("id, kind, status, details, decided_at, decision_note").eq("entity", "quote").eq("entity_id", q.id).order("created_at", { ascending: false }),
    supabase.from("contracts").select("number, status").eq("quote_id", q.id).neq("status", "cancelled").maybeSingle(),
    supabase.from("client_portal_links").select("contract_id, expires_at, revoked_at, open_count, last_opened_at").eq("quote_id", q.id).order("created_at", { ascending: false }),
    owner ? rows(supabase.from("contracts").select("id").eq("quote_id", q.id).limit(1)) : Promise.resolve([] as { id: string }[]),
  ]);
  const activeLink = (links ?? []).find((l) => !l.revoked_at && new Date(l.expires_at) > new Date());
  const cur = (versions ?? []).find((v) => v.version === q.current_version) ?? null;
  let internal: QuoteDetail["internal"] = null;
  if (cur && can(session, "costs.view")) {
    const { data: c } = await supabase.from("quote_version_costs").select("*").eq("quote_version_id", cur.id).maybeSingle();
    const partner = c?.marketer_id ? (await loadMarketerChoices(supabase, orgId)).find((m) => m.id === c.marketer_id) : null;
    if (c)
      internal = {
        cost: n(c.cost), costWithContingency: n(c.cost_with_contingency), marginPercent: n(c.margin_percent), lines: c.lines as unknown as Line[], purchaseList: c.purchase_list as unknown as PurchaseItem[],
        reward: c.marketer_id && n(c.commission_percent) > 0 ? { name: partner?.name ?? "—", percent: n(c.commission_percent), amount: n(c.commission_amount) } : null,
      };
  }
  return {
    quote: { id: q.id, number: q.number, service: q.service, status: q.status, version: q.current_version, valid_until: q.valid_until, created_at: q.created_at },
    client: client ?? { number: "", name: "—", phone: null, city: null },
    survey,
    current: cur ? { version: cur.version, clientView: cur.client_view as unknown as ClientView, notes: cur.notes, estimated: cur.estimated, created_at: cur.created_at, quantities: cur.quantities as unknown as Quantities } : null,
    versions: (versions ?? []).map((v) => ({
      version: v.version, total: n(v.total), created_at: v.created_at,
      brands: [...new Set(((v.client_view as unknown as ClientView | null)?.included ?? []).map((i) => i.brand).filter((b): b is string => !!b))],
    })),
    options: q.options ?? null,
    internal,
    approvals: (approvals ?? []).map((a) => ({ ...a, details: (a.details ?? {}) as Record<string, unknown> })),
    canManage: can(session, "quotes.manage") && can(session, "costs.view"),
    canPurchase: can(session, "purchases.manage"),
    canDecide: can(session, "approvals.decide"),
    contract: contract ?? null,
    clientDecision: q.client_decision && q.client_decided_at
      ? { decision: q.client_decision, at: q.client_decided_at, name: q.client_name ?? null, note: q.client_note ?? null, version: q.client_version ?? null, ip: q.client_ip ?? null }
      : null,
    link: { active: !!activeLink, expires_at: activeLink?.expires_at ?? null, open_count: activeLink?.open_count ?? 0, last_opened_at: activeLink?.last_opened_at ?? null, onContract: !!activeLink?.contract_id },
    canDelete: owner,
    ...(owner ? { anyContract: allContracts.length > 0 } : {}),
  };
}

/** Home «عروض تنتظرك»: quotes the client answered on his page that wait for us (quotes.view). */
export async function loadQuotesWaiting(session: SessionContext): Promise<QuoteWaiting[]> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: qs } = await supabase
    .from("quotes")
    .select("id, number, status, client_id, client_decision, client_decided_at")
    .eq("organization_id", orgId)
    .in("client_decision", ["accepted", "changes_requested"])
    .order("client_decided_at")
    .limit(50);
  if (!qs?.length) return [];
  const [clients, contracts] = await Promise.all([
    rows(supabase.from("clients").select("id, name").in("id", [...new Set(qs.map((q) => q.client_id))])),
    rows(supabase.from("contracts").select("quote_id").in("quote_id", qs.map((q) => q.id)).neq("status", "cancelled")),
  ]);
  const name = new Map(clients.map((c) => [c.id, c.name]));
  const withContract = new Set(contracts.map((c) => c.quote_id));
  return quotesWaiting(qs.map((q) => ({
    number: q.number, client: name.get(q.client_id) ?? "—", decision: q.client_decision ?? null, decided_at: q.client_decided_at ?? null, status: q.status, hasContract: withContract.has(q.id),
  })));
}
