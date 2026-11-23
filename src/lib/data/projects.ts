import "server-only";
import { notFound } from "next/navigation";
import { aiConfigured } from "@/lib/ai/invoice";
import { can, type SessionContext } from "@/lib/auth/session";
import { currentStage, overallProgress } from "@/lib/execution";
import type { ServiceKind } from "@/lib/pricing";
import type { StageStatus } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type ProjectListItem = {
  id: string; number: string; client: string; service: ServiceKind; start_date: string; duration_days: number;
  progress: number; stage: string | null; stageStatus: StageStatus | null; lastVisit: string | null; newNotes: number; done: boolean;
};

export async function loadProjects(session: SessionContext): Promise<ProjectListItem[]> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: contracts }, { data: clients }, { data: stages }, { data: visits }, { data: notes }] = await Promise.all([
    supabase.from("contracts").select("id, number, client_id, service, start_date, duration_days").eq("organization_id", orgId).eq("status", "accepted").order("start_date", { ascending: false }),
    supabase.from("clients").select("id, name").eq("organization_id", orgId),
    supabase.from("project_stages").select("contract_id, seq, name, status, progress, is_final").eq("organization_id", orgId),
    supabase.from("site_visits").select("contract_id, checked_in_at").eq("organization_id", orgId).order("checked_in_at", { ascending: false }).limit(2000),
    supabase.from("client_notes").select("contract_id").eq("organization_id", orgId).eq("status", "new"),
  ]);
  const names = new Map((clients ?? []).map((c) => [c.id, c.name]));
  return (contracts ?? []).map((c) => {
    const own = (stages ?? []).filter((s) => s.contract_id === c.id);
    const cur = currentStage(own);
    return {
      id: c.id, number: c.number, client: names.get(c.client_id) ?? "—", service: c.service, start_date: c.start_date, duration_days: c.duration_days,
      progress: overallProgress(own), stage: cur?.name ?? null, stageStatus: cur?.status ?? null,
      lastVisit: (visits ?? []).find((v) => v.contract_id === c.id)?.checked_in_at ?? null,
      newNotes: (notes ?? []).filter((n) => n.contract_id === c.id).length,
      done: own.length > 0 && !cur,
    };
  });
}

export type StageView = {
  id: string; seq: number; name: string; status: StageStatus; progress: number; is_final: boolean; payment_event: string | null;
  report: string | null; report_ai: boolean; sent_at: string | null; confirmed_at: string | null; confirmed_name: string | null; signed: boolean;
  updates: { id: string; progress: number; note: string | null; photos: { path: string; url: string | null }[]; created_at: string; visible: boolean }[];
};
export type ProjectDetail = {
  contract: { id: string; number: string; service: ServiceKind; start_date: string; duration_days: number; warranty_months: number; accepted_at: string | null };
  client: { name: string; phone: string | null; city: string | null; district: string | null; location_url: string | null };
  /** company name, signs the ready WhatsApp messages */
  orgName?: string;
  stages: StageView[];
  visits: { id: string; checked_in_at: string; latitude: number | null; longitude: number | null; accuracy_m: number | null; note: string | null; by: string | null }[];
  notes: { id: string; body: string; photos: { path: string; url: string | null }[]; status: "new" | "seen" | "resolved"; reply: string | null; stage_id: string | null; created_at: string }[];
  payments: { seq: number; label: string; amount: number; due_event: string; status: string }[];
  canManage: boolean;
  /** may record purchases for this project (purchases.manage) */
  canPurchase: boolean;
  aiEnabled: boolean;
};

export async function loadProject(session: SessionContext, number: string): Promise<ProjectDetail> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: c } = await supabase.from("contracts").select("id, number, service, start_date, duration_days, warranty_months, accepted_at, client_id, status").eq("organization_id", orgId).eq("number", number).maybeSingle();
  if (!c || c.status !== "accepted") notFound();
  const [{ data: client }, { data: stages }, { data: updates }, { data: visits }, { data: notes }, { data: payments }, { data: members }] = await Promise.all([
    supabase.from("clients").select("name, phone, city, district, location_url").eq("id", c.client_id).maybeSingle(),
    supabase.from("project_stages").select("*").eq("contract_id", c.id).order("seq"),
    supabase.from("progress_updates").select("id, stage_id, progress, note, photos, created_at, visible_to_client").eq("contract_id", c.id).order("created_at", { ascending: false }).limit(300),
    supabase.from("site_visits").select("id, checked_in_at, latitude, longitude, accuracy_m, note, created_by").eq("contract_id", c.id).order("checked_in_at", { ascending: false }).limit(30),
    supabase.from("client_notes").select("id, body, photos, status, reply, stage_id, created_at").eq("contract_id", c.id).order("created_at", { ascending: false }),
    supabase.from("contract_payments").select("seq, label, amount, due_event, status").eq("contract_id", c.id).order("seq"),
    supabase.from("profiles").select("id, full_name"),
  ]);
  // short-lived signed URLs for every photo on the page (private bucket)
  const paths = [...new Set([...(updates ?? []).flatMap((u) => u.photos), ...(notes ?? []).flatMap((n) => n.photos)])];
  const { data: signed } = paths.length ? await supabase.storage.from("project-photos").createSignedUrls(paths, 600) : { data: [] };
  const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const photo = (p: string) => ({ path: p, url: url.get(p) ?? null });
  const who = new Map((members ?? []).map((m) => [m.id, m.full_name]));
  return {
    contract: { id: c.id, number: c.number, service: c.service, start_date: c.start_date, duration_days: c.duration_days, warranty_months: c.warranty_months, accepted_at: c.accepted_at },
    client: client ?? { name: "—", phone: null, city: null, district: null, location_url: null },
    orgName: session.organization.name,
    stages: (stages ?? []).map((s) => ({
      id: s.id, seq: s.seq, name: s.name, status: s.status, progress: s.progress, is_final: s.is_final, payment_event: s.payment_event,
      report: s.report, report_ai: s.report_ai, sent_at: s.sent_at, confirmed_at: s.confirmed_at, confirmed_name: s.confirmed_name, signed: !!s.confirmed_signature,
      updates: (updates ?? []).filter((u) => u.stage_id === s.id).map((u) => ({ id: u.id, progress: u.progress, note: u.note, photos: u.photos.map(photo), created_at: u.created_at, visible: u.visible_to_client })),
    })),
    visits: (visits ?? []).map((v) => ({ ...v, latitude: v.latitude == null ? null : Number(v.latitude), longitude: v.longitude == null ? null : Number(v.longitude), accuracy_m: v.accuracy_m == null ? null : Number(v.accuracy_m), by: v.created_by ? (who.get(v.created_by) ?? null) : null })),
    notes: (notes ?? []).map((n) => ({ ...n, photos: n.photos.map(photo) })),
    payments: (payments ?? []).map((p) => ({ ...p, amount: Number(p.amount) })),
    canManage: can(session, "projects.manage"),
    canPurchase: can(session, "purchases.manage"),
    aiEnabled: aiConfigured(),
  };
}

/** Final handover certificate (print): only once the client has signed the final stage. */
export async function loadCertificate(session: SessionContext, number: string) {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: c } = await supabase.from("contracts").select("id, number, service, start_date, warranty_months, client_id, total").eq("organization_id", orgId).eq("number", number).maybeSingle();
  if (!c) notFound();
  const [{ data: client }, { data: final }] = await Promise.all([
    supabase.from("clients").select("name, phone, city, district, id_number").eq("id", c.client_id).maybeSingle(),
    supabase.from("project_stages").select("confirmed_at, confirmed_name, confirmed_signature, confirmed_ip").eq("contract_id", c.id).eq("is_final", true).eq("status", "confirmed").maybeSingle(),
  ]);
  if (!final) notFound();
  return { contract: { ...c, total: Number(c.total) }, client, final };
}
