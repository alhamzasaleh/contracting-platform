import "server-only";
import { loadMarketerChoices, type MarketerChoice } from "@/lib/data/marketers";
import { notFound } from "next/navigation";
import { can, type SessionContext } from "@/lib/auth/session";
import type { SurveyRoom, SurveyTotals } from "@/lib/survey";
import { once, rows } from "@/lib/data/query";
import { createClient } from "@/lib/supabase/server";
import { readPendingPins } from "@/lib/geo-pins";
import { upcomingSurveys, type UpcomingSurvey } from "@/lib/survey/upcoming";

const n = (v: unknown) => Number(v ?? 0);

export type ClientListItem = {
  id: string;
  number: string;
  name: string;
  phone: string | null;
  city: string | null;
  surveys: number;
  quotes: number;
  created_at: string;
};

export async function loadClients(session: SessionContext): Promise<ClientListItem[]> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: clients }, { data: surveys }, { data: quotes }] = await Promise.all([
    supabase.from("clients").select("id, number, name, phone, city, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }),
    supabase.from("surveys").select("client_id").eq("organization_id", orgId),
    supabase.from("quotes").select("client_id").eq("organization_id", orgId),
  ]);
  const count = (rows: { client_id: string }[] | null, id: string) => (rows ?? []).filter((r) => r.client_id === id).length;
  return (clients ?? []).map((c) => ({ ...c, surveys: count(surveys, c.id), quotes: count(quotes, c.id) }));
}

export type ClientDetail = {
  client: { id: string; number: string; name: string; phone: string | null; city: string | null; district: string | null; id_number: string | null; location_url: string | null; notes: string | null; marketer_id?: string | null; latitude?: number | null; longitude?: number | null };
  /** success partners for «جاء عن طريق» (names only; marketer_choices) */
  marketers?: MarketerChoice[];
  /** may open /partners (marketers.manage or finance.view) */
  canOpenPartners?: boolean;
  /** quotes = quotes built on this survey (it can't be deleted while there are any) */
  surveys: { id: string; number: string; title: string | null; mode: "total" | "rooms"; visit_date: string | null; visit_time?: string | null; ownSite?: boolean; rooms: number; quotes?: number }[];
  /** hasContract = any contract, even cancelled (owner only — for «حذف») */
  quotes: { id: string; number: string; service: "gypsum" | "interior" | "exterior"; status: string; version: number; total: number | null; created_at: string; clientDecision?: "accepted" | "changes_requested" | "rejected" | null; hasContract?: boolean }[];
  /** contracts (quotes.view) — accepted ones are projects; openMaintenance = open requests */
  contracts?: { number: string; service: "gypsum" | "interior" | "exterior"; status: string; total: number; openMaintenance: number }[];
  /** what he owes (finance.view): accepted contracts + accepted additional works vs receipt vouchers */
  balance?: { billed: number; received: number; outstanding: number } | null;
  /** his invoices (finance.view) */
  invoices?: { number: string; total: number; issue_date: string }[];
  canViewProjects?: boolean;
  /** the owner may delete the client and his surveys (public.delete_client / delete_survey) */
  canDelete?: boolean;
  /** all his contracts, cancelled included (owner only) — any contract keeps the client */
  contractCount?: number;
};

export async function loadClientDetail(session: SessionContext, number: string): Promise<ClientDetail> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: found } = await supabase
    .from("clients")
    .select("id, number, name, phone, city, district, id_number, location_url, notes, marketer_id, latitude, longitude, pin_pending")
    .eq("organization_id", orgId)
    .eq("number", number)
    .maybeSingle();
  if (!found) notFound();
  const { pin_pending, ...client } = found;
  // a short map link not read yet is read now (≤ 3 s), so the page shows the pin
  if (pin_pending && client.latitude == null) {
    const pin = (await readPendingPins({ orgId, clientIds: [client.id], budgetMs: 3000 })).get(client.id);
    if (pin) Object.assign(client, { latitude: pin.lat, longitude: pin.lng });
  }
  const finance = can(session, "finance.view");
  const surveysP = once(supabase.from("surveys").select("id, number, title, mode, visit_date, visit_time, latitude").eq("client_id", client.id).order("created_at", { ascending: false }));
  const owner = session.role === "owner";
  const quotesP = once(supabase.from("quotes").select("id, number, service, status, current_version, created_at, client_decision, survey_id").eq("client_id", client.id).order("created_at", { ascending: false }));
  const contractsP: Promise<{ data: { id: string; number: string; service: "gypsum" | "interior" | "exterior"; status: string; total: number }[] | null }> = can(session, "quotes.view")
    ? once(supabase.from("contracts").select("id, number, service, status, total").eq("client_id", client.id).neq("status", "cancelled").order("created_at", { ascending: false }))
    : Promise.resolve({ data: [] });
  // one parallel round after the client; queries that need his surveys / quotes / contracts are chained onto them
  const [{ data: surveys }, rooms, { data: quotes }, versions, { data: contracts }, [repairs, addenda, receipts, invoices], allContracts, marketers] = await Promise.all([
    surveysP,
    // rooms of his surveys only (counted per survey)
    surveysP.then(({ data }) => {
      const ids = (data ?? []).map((x) => x.id);
      return ids.length ? rows(supabase.from("survey_rooms").select("survey_id").in("survey_id", ids)) : [];
    }),
    quotesP,
    quotesP.then(({ data }) => {
      const ids = (data ?? []).map((q) => q.id);
      return ids.length ? rows(supabase.from("quote_versions").select("quote_id, version, total").in("quote_id", ids)) : [];
    }),
    contractsP,
    contractsP.then(({ data }) => {
      const cids = (data ?? []).map((c) => c.id);
      const accepted = (data ?? []).filter((c) => c.status === "accepted").map((c) => c.id);
      return Promise.all([
        cids.length && can(session, "projects.view") ? rows(supabase.from("maintenance_requests").select("contract_id").in("contract_id", cids).in("status", ["open", "in_progress", "resolved"])) : [],
        finance && accepted.length ? rows(supabase.from("addenda").select("contract_id, total").in("contract_id", accepted).eq("status", "accepted")) : [],
        finance && cids.length ? rows(supabase.from("client_receipts").select("amount").in("contract_id", cids)) : [],
        finance && cids.length ? rows(supabase.from("invoices").select("number, total, issue_date").in("contract_id", cids).order("issue_date", { ascending: false }).limit(100)) : [],
      ]);
    }),
    // owner: every contract of his, cancelled included — any contract keeps the client and its quote
    owner ? rows(supabase.from("contracts").select("quote_id").eq("client_id", client.id)) : Promise.resolve([] as { quote_id: string }[]),
    loadMarketerChoices(supabase, orgId),
  ]);
  const accepted = (contracts ?? []).filter((c) => c.status === "accepted").map((c) => c.id);
  const billed = (contracts ?? []).filter((c) => c.status === "accepted").reduce((s, c) => s + n(c.total), 0) + addenda.reduce((s, a) => s + n(a.total), 0);
  const received = receipts.reduce((s, r) => s + n(r.amount), 0);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    client,
    marketers,
    canOpenPartners: can(session, "marketers.manage") || can(session, "finance.view"),
    surveys: (surveys ?? []).map(({ latitude, ...s }) => ({ ...s, ownSite: latitude != null, rooms: (rooms ?? []).filter((r) => r.survey_id === s.id).length, quotes: (quotes ?? []).filter((q) => q.survey_id === s.id).length })),
    quotes: (quotes ?? []).map((q) => ({
      id: q.id,
      number: q.number,
      service: q.service,
      status: q.status,
      clientDecision: q.client_decision ?? null,
      version: q.current_version,
      total: (() => {
        const v = (versions ?? []).find((x) => x.quote_id === q.id && x.version === q.current_version);
        return v ? n(v.total) : null;
      })(),
      created_at: q.created_at,
      ...(owner ? { hasContract: allContracts.some((c) => c.quote_id === q.id) } : {}),
    })),
    contracts: (contracts ?? []).map((c) => ({ number: c.number, service: c.service, status: c.status, total: n(c.total), openMaintenance: (repairs ?? []).filter((m) => m.contract_id === c.id).length })),
    balance: finance && accepted.length ? { billed: r2(billed), received: r2(received), outstanding: r2(Math.max(0, billed - received)) } : null,
    invoices: (invoices ?? []).map((i) => ({ number: i.number, total: n(i.total), issue_date: i.issue_date })),
    canViewProjects: can(session, "projects.view"),
    canDelete: owner,
    ...(owner ? { contractCount: allContracts.length } : {}),
  };
}

export type SurveyDetail = {
  survey: { id: string; number: string; title: string | null; mode: "total" | "rooms"; visit_date: string | null; visit_time?: string | null; latitude?: number | null; longitude?: number | null; site_city?: string | null; site_district?: string | null; notes: string | null; totals: SurveyTotals };
  client: { id: string; number: string; name: string; latitude?: number | null; longitude?: number | null; city?: string | null; district?: string | null; location_url?: string | null };
  rooms: SurveyRoom[];
  /** an accepted contract made from this survey: its project keeps the site it had when sent */
  project?: string | null;
  /** a contract sent to the client (not yet accepted): its place is frozen since sending */
  sentContract?: string | null;
  /** quotes.view: the contract number links to it */
  canOpenContract?: boolean;
  /** the project page opens (projects.view) — else the number is plain text */
  canOpenProject?: boolean;
  /** the owner may delete it (public.delete_survey) — not while quotes are built on it */
  canDelete?: boolean;
  quotes?: number;
};

export async function loadSurvey(session: SessionContext, clientNumber: string, surveyNumber: string): Promise<SurveyDetail> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: survey } = await supabase
    .from("surveys")
    .select("id, number, title, mode, visit_date, visit_time, latitude, longitude, site_city, site_district, notes, totals, client_id")
    .eq("organization_id", orgId)
    .eq("number", surveyNumber)
    .maybeSingle();
  if (!survey) notFound();
  const owner = session.role === "owner";
  const [{ data: found }, { data: rooms }, onSurvey, project] = await Promise.all([
    supabase.from("clients").select("id, number, name, latitude, longitude, city, district, location_url, pin_pending").eq("id", survey.client_id).maybeSingle(),
    supabase.from("survey_rooms").select("*").eq("survey_id", survey.id).order("sort_order").order("created_at"),
    owner ? rows(supabase.from("quotes").select("id").eq("survey_id", survey.id)) : Promise.resolve([] as { id: string }[]),
    rows(supabase.from("quotes").select("id").eq("survey_id", survey.id)).then(async (qs) =>
      qs.length ? rows(supabase.from("contracts").select("number, status").in("quote_id", qs.map((q) => q.id)).in("status", ["sent", "accepted"])) : [],
    ),
  ]);
  if (!found || found.number !== clientNumber) notFound();
  const { pin_pending, ...client } = found;
  // the survey at the client's site and his short map link not read yet: read it now (≤ 3 s)
  if (survey.latitude == null && pin_pending && client.latitude == null) {
    const pin = (await readPendingPins({ orgId, clientIds: [client.id], budgetMs: 3000 })).get(client.id);
    if (pin) Object.assign(client, { latitude: pin.lat, longitude: pin.lng });
  }
  return {
    survey: { ...survey, totals: (survey.totals ?? {}) as SurveyTotals },
    client,
    rooms: (rooms ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      unit_label: r.unit_label,
      length_m: n(r.length_m),
      width_m: n(r.width_m),
      height_m: n(r.height_m),
      openings_m2: n(r.openings_m2),
      gypsum_ceiling: r.gypsum_ceiling,
      ceiling_board: r.ceiling_board,
      c_along: r.c_along ?? null,
      paint_walls: r.paint_walls,
      paint_ceiling: r.paint_ceiling,
      wall_zone: r.wall_zone,
    })),
    canDelete: owner,
    project: project.find((c) => c.status === "accepted")?.number ?? null,
    sentContract: project.find((c) => c.status === "sent")?.number ?? null,
    canOpenProject: can(session, "projects.view"),
    canOpenContract: can(session, "quotes.view"),
    ...(owner ? { quotes: onSurvey.length } : {}),
  };
}

/** «معاينات قادمة» (home, clients.view): visits booked from today within 14 days, not yet measured or quoted. */
export async function loadUpcomingSurveys(session: SessionContext, today: string): Promise<UpcomingSurvey[]> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 14);
  const surveys = await rows(
    supabase.from("surveys").select("id, number, visit_date, visit_time, latitude, longitude, totals, client_id").eq("organization_id", orgId)
      .gte("visit_date", today).lte("visit_date", end.toISOString().slice(0, 10)).order("visit_date").limit(50),
  );
  if (!surveys.length) return [];
  const ids = surveys.map((s) => s.id);
  const [clients, measured, quoted] = await Promise.all([
    rows(supabase.from("clients").select("id, number, name, latitude, longitude, location_url").in("id", [...new Set(surveys.map((s) => s.client_id))])),
    rows(supabase.from("survey_rooms").select("survey_id").in("survey_id", ids)),
    rows(supabase.from("quotes").select("survey_id").in("survey_id", ids)),
  ]);
  const byId = new Map(clients.map((c) => [c.id, c]));
  const done = new Set([...measured.map((r) => r.survey_id), ...quoted.map((q) => q.survey_id)]);
  return upcomingSurveys(
    surveys.map((s) => {
      const c = byId.get(s.client_id);
      const totals = s.totals && typeof s.totals === "object" ? Object.keys(s.totals as object).length : 0;
      return {
        number: s.number, visit_date: s.visit_date, visit_time: s.visit_time ?? null, latitude: s.latitude ?? null, longitude: s.longitude ?? null,
        done: done.has(s.id) || totals > 0,
        client: c ? { number: c.number, name: c.name, latitude: c.latitude ?? null, longitude: c.longitude ?? null, location_url: c.location_url } : null,
      };
    }),
    today,
  );
}
