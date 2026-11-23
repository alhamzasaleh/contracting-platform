import "server-only";
import { notFound } from "next/navigation";
import { can, type SessionContext } from "@/lib/auth/session";
import type { SurveyRoom, SurveyTotals } from "@/lib/survey";
import { createClient } from "@/lib/supabase/server";

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
  client: { id: string; number: string; name: string; phone: string | null; city: string | null; district: string | null; id_number: string | null; location_url: string | null; notes: string | null };
  surveys: { id: string; number: string; title: string | null; mode: "total" | "rooms"; visit_date: string | null; rooms: number }[];
  quotes: { id: string; number: string; service: "gypsum" | "interior" | "exterior"; status: string; version: number; total: number | null; created_at: string }[];
  /** contracts (quotes.view) — accepted ones are projects; openMaintenance = open requests */
  contracts?: { number: string; service: "gypsum" | "interior" | "exterior"; status: string; total: number; openMaintenance: number }[];
  /** what he owes (finance.view): accepted contracts + accepted additional works vs receipt vouchers */
  balance?: { billed: number; received: number; outstanding: number } | null;
  /** his invoices (finance.view) */
  invoices?: { number: string; total: number; issue_date: string }[];
  canViewProjects?: boolean;
};

export async function loadClientDetail(session: SessionContext, number: string): Promise<ClientDetail> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: client } = await supabase
    .from("clients")
    .select("id, number, name, phone, city, district, id_number, location_url, notes")
    .eq("organization_id", orgId)
    .eq("number", number)
    .maybeSingle();
  if (!client) notFound();
  const [{ data: surveys }, { data: rooms }, { data: quotes }] = await Promise.all([
    supabase.from("surveys").select("id, number, title, mode, visit_date").eq("client_id", client.id).order("created_at", { ascending: false }),
    supabase.from("survey_rooms").select("survey_id").eq("organization_id", orgId),
    supabase.from("quotes").select("id, number, service, status, current_version, created_at").eq("client_id", client.id).order("created_at", { ascending: false }),
  ]);
  const finance = can(session, "finance.view");
  const { data: contracts } = can(session, "quotes.view")
    ? await supabase.from("contracts").select("id, number, service, status, total").eq("client_id", client.id).neq("status", "cancelled").order("created_at", { ascending: false })
    : { data: [] as { id: string; number: string; service: "gypsum" | "interior" | "exterior"; status: string; total: number }[] };
  const cids = (contracts ?? []).map((c) => c.id);
  const accepted = (contracts ?? []).filter((c) => c.status === "accepted").map((c) => c.id);
  const [{ data: repairs }, { data: addenda }, { data: receipts }, { data: invoices }] = await Promise.all([
    cids.length && can(session, "projects.view") ? supabase.from("maintenance_requests").select("contract_id").in("contract_id", cids).in("status", ["open", "in_progress", "resolved"]) : Promise.resolve({ data: [] as { contract_id: string }[] }),
    finance && accepted.length ? supabase.from("addenda").select("contract_id, total").in("contract_id", accepted).eq("status", "accepted") : Promise.resolve({ data: [] as { contract_id: string; total: number }[] }),
    finance && cids.length ? supabase.from("client_receipts").select("amount").in("contract_id", cids) : Promise.resolve({ data: [] as { amount: number }[] }),
    finance && cids.length ? supabase.from("invoices").select("number, total, issue_date").in("contract_id", cids).order("issue_date", { ascending: false }).limit(100) : Promise.resolve({ data: [] as { number: string; total: number; issue_date: string }[] }),
  ]);
  const billed = (contracts ?? []).filter((c) => c.status === "accepted").reduce((s, c) => s + n(c.total), 0) + (addenda ?? []).reduce((s, a) => s + n(a.total), 0);
  const received = (receipts ?? []).reduce((s, r) => s + n(r.amount), 0);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const ids = (quotes ?? []).map((q) => q.id);
  const { data: versions } = ids.length
    ? await supabase.from("quote_versions").select("quote_id, version, total").in("quote_id", ids)
    : { data: [] as { quote_id: string; version: number; total: number }[] };
  return {
    client,
    surveys: (surveys ?? []).map((s) => ({ ...s, rooms: (rooms ?? []).filter((r) => r.survey_id === s.id).length })),
    quotes: (quotes ?? []).map((q) => ({
      id: q.id,
      number: q.number,
      service: q.service,
      status: q.status,
      version: q.current_version,
      total: (() => {
        const v = (versions ?? []).find((x) => x.quote_id === q.id && x.version === q.current_version);
        return v ? n(v.total) : null;
      })(),
      created_at: q.created_at,
    })),
    contracts: (contracts ?? []).map((c) => ({ number: c.number, service: c.service, status: c.status, total: n(c.total), openMaintenance: (repairs ?? []).filter((m) => m.contract_id === c.id).length })),
    balance: finance && accepted.length ? { billed: r2(billed), received: r2(received), outstanding: r2(Math.max(0, billed - received)) } : null,
    invoices: (invoices ?? []).map((i) => ({ number: i.number, total: n(i.total), issue_date: i.issue_date })),
    canViewProjects: can(session, "projects.view"),
  };
}

export type SurveyDetail = {
  survey: { id: string; number: string; title: string | null; mode: "total" | "rooms"; visit_date: string | null; notes: string | null; totals: SurveyTotals };
  client: { id: string; number: string; name: string };
  rooms: SurveyRoom[];
};

export async function loadSurvey(session: SessionContext, clientNumber: string, surveyNumber: string): Promise<SurveyDetail> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: survey } = await supabase
    .from("surveys")
    .select("id, number, title, mode, visit_date, notes, totals, client_id")
    .eq("organization_id", orgId)
    .eq("number", surveyNumber)
    .maybeSingle();
  if (!survey) notFound();
  const [{ data: client }, { data: rooms }] = await Promise.all([
    supabase.from("clients").select("id, number, name").eq("id", survey.client_id).maybeSingle(),
    supabase.from("survey_rooms").select("*").eq("survey_id", survey.id).order("sort_order").order("created_at"),
  ]);
  if (!client || client.number !== clientNumber) notFound();
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
      paint_walls: r.paint_walls,
      paint_ceiling: r.paint_ceiling,
      wall_zone: r.wall_zone,
    })),
  };
}
