import "server-only";
import { notFound } from "next/navigation";
import { can, type SessionContext } from "@/lib/auth/session";
import { loadPricingContext } from "@/lib/data/pricing";
import type { Quantities, Selection, ServiceKind } from "@/lib/pricing";
import type { ClientView, PurchaseItem } from "@/lib/quotes";
import type { QuoteStatus } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { surveyGaps, surveyQuantities, type SurveyRoom, type SurveyTotals } from "@/lib/survey";
import type { Line } from "@/lib/engine";

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
};

export async function loadQuotes(session: SessionContext): Promise<QuoteListItem[]> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: quotes }, { data: clients }, { data: versions }] = await Promise.all([
    supabase.from("quotes").select("id, number, client_id, service, status, current_version, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }),
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
  let quote: { id: string; number: string; service: ServiceKind; survey_id: string | null; current_version: number } | null = null;
  let initial: Selection | null = null;
  let discount = 0;
  let method: "unit" | "lump" = "unit";
  let notes: string | null = null;
  if (args.quoteNumber) {
    const { data } = await supabase.from("quotes").select("id, number, service, survey_id, current_version").eq("organization_id", orgId).eq("number", args.quoteNumber).maybeSingle();
    if (!data || !data.survey_id) notFound();
    quote = data;
    const { data: v } = await supabase.from("quote_versions").select("selection, discount, client_view, pricing_method, notes").eq("quote_id", data.id).eq("version", data.current_version).maybeSingle();
    if (v) {
      initial = v.selection as unknown as Selection;
      discount = n((v.client_view as { discountPercent?: number } | null)?.discountPercent ?? 0);
      method = v.pricing_method;
      notes = v.notes;
    }
  }
  const kind = (quote?.service ?? args.service)!;
  const src = await surveySource(supabase, orgId, quote ? { id: quote.survey_id! } : { number: args.surveyNumber }, kind);
  if (!src) notFound();
  const { ctx, templates, canSeeCrewCost } = await loadPricingContext(session);
  return { quote, kind, initial, discount, method, notes, ...src, ctx, templates, canSeeCrewCost };
}

export type QuoteDetail = {
  quote: { id: string; number: string; service: ServiceKind; status: QuoteStatus; version: number; valid_until: string | null; created_at: string };
  client: { number: string; name: string; phone: string | null; city: string | null };
  survey: { number: string } | null;
  current: { version: number; clientView: ClientView; notes: string | null; estimated: boolean; created_at: string; quantities: Quantities } | null;
  versions: { version: number; total: number; created_at: string; brands: string[] }[];
  /** 2–3 versions offered side by side (null = a single quote) */
  options: { version: number; label: string }[] | null;
  internal: { cost: number; costWithContingency: number; marginPercent: number; lines: Line[]; purchaseList: PurchaseItem[] } | null;
  approvals: { id: string; kind: string; status: string; details: Record<string, unknown>; decided_at: string | null; decision_note: string | null }[];
  canManage: boolean;
  canDecide: boolean;
  contract: { number: string; status: string } | null;
};

export async function loadQuote(session: SessionContext, number: string): Promise<QuoteDetail> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: q } = await supabase.from("quotes").select("*").eq("organization_id", orgId).eq("number", number).maybeSingle();
  if (!q) notFound();
  const [{ data: client }, { data: survey }, { data: versions }, { data: approvals }, { data: contract }] = await Promise.all([
    supabase.from("clients").select("number, name, phone, city").eq("id", q.client_id).maybeSingle(),
    q.survey_id ? supabase.from("surveys").select("number").eq("id", q.survey_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("quote_versions").select("id, version, total, created_at, client_view, notes, estimated, quantities").eq("quote_id", q.id).order("version", { ascending: false }),
    supabase.from("approvals").select("id, kind, status, details, decided_at, decision_note").eq("entity", "quote").eq("entity_id", q.id).order("created_at", { ascending: false }),
    supabase.from("contracts").select("number, status").eq("quote_id", q.id).neq("status", "cancelled").maybeSingle(),
  ]);
  const cur = (versions ?? []).find((v) => v.version === q.current_version) ?? null;
  let internal: QuoteDetail["internal"] = null;
  if (cur && can(session, "costs.view")) {
    const { data: c } = await supabase.from("quote_version_costs").select("*").eq("quote_version_id", cur.id).maybeSingle();
    if (c) internal = { cost: n(c.cost), costWithContingency: n(c.cost_with_contingency), marginPercent: n(c.margin_percent), lines: c.lines as unknown as Line[], purchaseList: c.purchase_list as unknown as PurchaseItem[] };
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
    canDecide: can(session, "approvals.decide"),
    contract: contract ?? null,
  };
}
