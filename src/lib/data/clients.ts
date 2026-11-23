import "server-only";
import { notFound } from "next/navigation";
import type { SessionContext } from "@/lib/auth/session";
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
  client: { id: string; number: string; name: string; phone: string | null; city: string | null; district: string | null; location_url: string | null; notes: string | null };
  surveys: { id: string; number: string; title: string | null; mode: "total" | "rooms"; visit_date: string | null; rooms: number }[];
  quotes: { id: string; number: string; service: "gypsum" | "interior" | "exterior"; status: string; version: number; total: number | null; created_at: string }[];
};

export async function loadClientDetail(session: SessionContext, number: string): Promise<ClientDetail> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: client } = await supabase
    .from("clients")
    .select("id, number, name, phone, city, district, location_url, notes")
    .eq("organization_id", orgId)
    .eq("number", number)
    .maybeSingle();
  if (!client) notFound();
  const [{ data: surveys }, { data: rooms }, { data: quotes }] = await Promise.all([
    supabase.from("surveys").select("id, number, title, mode, visit_date").eq("client_id", client.id).order("created_at", { ascending: false }),
    supabase.from("survey_rooms").select("survey_id").eq("organization_id", orgId),
    supabase.from("quotes").select("id, number, service, status, current_version, created_at").eq("client_id", client.id).order("created_at", { ascending: false }),
  ]);
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
