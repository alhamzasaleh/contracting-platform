import "server-only";
import { projectLate, siteOf, type LatLng } from "@/lib/geo";
import { loadContractCommission, type ContractCommission } from "@/lib/data/marketers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { aiConfigured } from "@/lib/ai/invoice";
import { can, type SessionContext } from "@/lib/auth/session";
import { loadProjectCosts } from "@/lib/data/purchases";
import { currentStage, overallProgress } from "@/lib/execution";
import { deliveryDate } from "@/lib/contracts";
import { loadBookingTeam, loadWarrantyEnd } from "@/lib/data/contracts";
import { loadStaffNames } from "@/lib/data/staff";
import { loadMeasurements } from "@/lib/data/measurements";
import { measurementTotals, type MeasureBasis, type Measurement } from "@/lib/measurements";
import { readPendingPins } from "@/lib/geo-pins";
import type { ServiceKind } from "@/lib/pricing";
import type { StageStatus } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type ProjectListItem = {
  id: string; number: string; client: string; service: ServiceKind; start_date: string; duration_days: number;
  progress: number; stage: string | null; stageStatus: StageStatus | null; lastVisit: string | null; newNotes: number; done: boolean;
  /** the site pin (client's pin, else coordinates in his map link) — for the projects map */
  site?: LatLng | null;
  clientNumber?: string;
  /** past its delivery date (incl. accepted additional works) and not handed over */
  late?: boolean;
};

/**
 * The projects' sites (their own pin, else their survey's, else the client's) through public.project_site_list —
 * projects.view is enough, so a supervisor without clients.view still sees where a project is.
 */
/** where a project's site comes from: its own pin, its survey's or the client's */
export type SiteSource = "project" | "survey" | "client";

export async function loadProjectSites(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string): Promise<Map<string, { site: LatLng | null; own: boolean; source: SiteSource | null; city: string | null; district: string | null }>> {
  const { data, error } = await supabase.rpc("project_site_list", { p_org: orgId });
  if (error) return new Map();
  return new Map((data ?? []).map((r) => [r.contract_id, { site: siteOf(r), own: r.own, source: r.source ?? null, city: r.city ?? null, district: r.district ?? null }]));
}

/** Read the organization's pending map links after the response (outside a request: skipped). */
function laterPendingPins(orgId: string) {
  try {
    after(() => readPendingPins({ orgId, limit: 10, budgetMs: 20_000 }).then(() => undefined));
  } catch {
    /* not in a request (tests) */
  }
}

export async function loadProjects(session: SessionContext): Promise<ProjectListItem[]> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: contracts }, { data: clients }, { data: stages }, { data: visits }, { data: notes }, { data: addenda }, sites] = await Promise.all([
    supabase.from("contracts").select("id, number, client_id, service, start_date, duration_days").eq("organization_id", orgId).eq("status", "accepted").order("start_date", { ascending: false }),
    supabase.from("clients").select("id, number, name").eq("organization_id", orgId),
    supabase.from("project_stages").select("contract_id, seq, name, status, progress, is_final").eq("organization_id", orgId),
    supabase.from("site_visits").select("contract_id, checked_in_at").eq("organization_id", orgId).order("checked_in_at", { ascending: false }).limit(2000),
    supabase.from("client_notes").select("contract_id").eq("organization_id", orgId).eq("status", "new"),
    supabase.from("addenda").select("contract_id, extra_days").eq("organization_id", orgId).eq("status", "accepted"),
    loadProjectSites(supabase, orgId),
  ]);
  // clients' short map links not read yet: read after the response (the list never waits for Google)
  if ((contracts ?? []).some((c) => !sites.get(c.id)?.site)) laterPendingPins(orgId);
  const byId = new Map((clients ?? []).map((c) => [c.id, c]));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  return (contracts ?? []).map((c) => {
    const own = (stages ?? []).filter((s) => s.contract_id === c.id);
    const cur = currentStage(own);
    return {
      id: c.id, number: c.number, client: byId.get(c.client_id)?.name ?? "—", service: c.service, start_date: c.start_date, duration_days: c.duration_days,
      progress: overallProgress(own), stage: cur?.name ?? null, stageStatus: cur?.status ?? null,
      lastVisit: (visits ?? []).find((v) => v.contract_id === c.id)?.checked_in_at ?? null,
      newNotes: (notes ?? []).filter((n) => n.contract_id === c.id).length,
      done: own.length > 0 && !cur,
      site: sites.get(c.id)?.site ?? null,
      clientNumber: byId.get(c.client_id)?.number,
      late: projectLate({ done: own.length > 0 && !cur, start: c.start_date, days: c.duration_days, extraDays: (addenda ?? []).filter((a) => a.contract_id === c.id).reduce((x, a) => x + (a.extra_days ?? 0), 0), today }),
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
  client: { number?: string; name: string; phone: string | null; city: string | null; district: string | null; location_url: string | null };
  /** where the project is: its own pin (siteOwn), else the client's; null = not set */
  site?: LatLng | null;
  siteOwn?: boolean;
  /** where the site comes from (project / survey / client) */
  siteSource?: SiteSource | null;
  /** the project's city / district (its survey's own site, else the client's) */
  place?: { city: string | null; district: string | null } | null;
  /** projects.manage: may set this project's own site */
  canSetSite?: boolean;
  /** clients.view: the client's name links to his page */
  canOpenClient?: boolean;
  /** company name, signs the ready WhatsApp messages */
  orgName?: string;
  stages: StageView[];
  visits: { id: string; checked_in_at: string; latitude: number | null; longitude: number | null; accuracy_m: number | null; note: string | null; by: string | null }[];
  notes: { id: string; body: string; photos: { path: string; url: string | null }[]; status: "new" | "seen" | "resolved"; reply: string | null; stage_id: string | null; created_at: string }[];
  /** kind measurement = «تسوية الأمتار»; adjust = what measurement sheets took off this payment (≤ 0) */
  payments: { seq: number; label: string; amount: number; due_event: string; status: string; kind?: "schedule" | "measurement"; adjust?: number }[];
  /** measurement sheets (owner, Nov 2026): what can be measured, the sheets, and what is owed back to the client */
  measure?: { basis: MeasureBasis | null; sheets: Measurement[]; owed: number };
  /** may record a refund to the client (finance.manage) */
  canRefund?: boolean;
  /** subcontractors on this project (purchases.view, RLS): agreed / earned / paid, linked to their card */
  subcontractors?: { number: string; name: string; scope: string; agreed: number; earned: number; paid: number }[];
  /** accepted additional works: their own payment, and the days they add */
  addenda?: { number: string; title: string; total: number; payment_status: "pending" | "requested" | "paid"; extra_days: number }[];
  /** planned start, delivery (incl. accepted addenda days) and the warranty end once handed over */
  dates?: { start: string; delivery: string; extraDays: number; warrantyEnd: string | null };
  /** estimated materials vs actual materials, and the full actual cost (costs.view) — details on /purchases/costs */
  cost?: { estimated: number | null; materials: number; actual: number; reward?: ContractCommission } | null;
  /** the team priced on the quote (G1) — pre-selected when opening the schedule */
  bookTeam?: string | null;
  /** open maintenance requests on this project */
  openMaintenance?: number;
  /** may open the schedule (schedule.view) */
  canSchedule?: boolean;
  canManage: boolean;
  /** may record purchases for this project (purchases.manage) */
  canPurchase: boolean;
  /** may open the contract page (quotes.view) */
  canViewContract: boolean;
  /** may open the project costs page (costs.view + purchases.view: it sits in the purchases section) */
  canOpenCosts: boolean;
  aiEnabled: boolean;
};

export async function loadProject(session: SessionContext, number: string): Promise<ProjectDetail> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: c } = await supabase.from("contracts").select("id, number, service, start_date, duration_days, warranty_months, accepted_at, client_id, status, quote_id, quote_version").eq("organization_id", orgId).eq("number", number).maybeSingle();
  if (!c || c.status !== "accepted") notFound();
  // Promise.resolve: a query builder runs again on every .then(); a real promise runs it once and can be shared
  const updatesP = Promise.resolve(supabase.from("progress_updates").select("id, stage_id, progress, note, photos, created_at, visible_to_client").eq("contract_id", c.id).order("created_at", { ascending: false }).limit(300));
  const visitsP = Promise.resolve(supabase.from("site_visits").select("id, checked_in_at, latitude, longitude, accuracy_m, note, created_by").eq("contract_id", c.id).order("checked_in_at", { ascending: false }).limit(30));
  const measuresP = loadMeasurements(supabase, c.id);
  const notesP = Promise.resolve(supabase.from("client_notes").select("id, body, photos, status, reply, stage_id, created_at").eq("contract_id", c.id).order("created_at", { ascending: false }));
  const [
    { data: client }, { data: stages }, { data: updates }, { data: visits }, { data: notes }, { data: payments }, who,
    { data: addenda }, { count: openMaintenance }, costs, warrantyEnd, bookTeam, signed, reward, sites, measures, subs,
  ] = await Promise.all([
    supabase.from("clients").select("number, name, phone, city, district, location_url").eq("id", c.client_id).maybeSingle(),
    supabase.from("project_stages").select("*").eq("contract_id", c.id).order("seq"),
    updatesP,
    visitsP,
    notesP,
    supabase.from("contract_payments").select("seq, label, amount, due_event, status, kind, measure_adjust").eq("contract_id", c.id).order("seq"),
    // the visitors' names only (linked employees: «name · job», no hr data)
    visitsP.then(({ data }) => loadStaffNames(supabase, orgId, (data ?? []).map((v) => v.created_by))),
    supabase.from("addenda").select("number, title, total, payment_status, extra_days").eq("contract_id", c.id).eq("status", "accepted").order("created_at"),
    supabase.from("maintenance_requests").select("id", { count: "exact", head: true }).eq("contract_id", c.id).in("status", ["open", "in_progress", "resolved"]),
    // this project's costs only (filtered in the database; the same figures as the costs page)
    can(session, "costs.view") ? loadProjectCosts(session, c.id) : Promise.resolve(null),
    // the database's own warranty end (handover + warranty months)
    loadWarrantyEnd(session, c.id),
    // G1: the team priced on the quote, pre-selected when booking
    supabase.from("quote_versions").select("selection").eq("quote_id", c.quote_id).eq("version", c.quote_version).maybeSingle().then(({ data }) => loadBookingTeam(session, data?.selection)),
    // short-lived signed URLs for every photo on the page (private bucket)
    Promise.all([updatesP, notesP, measuresP]).then(async ([u, nt, ms]): Promise<{ path: string | null; signedUrl: string | null }[]> => {
      const paths = [...new Set([...(u.data ?? []).flatMap((x) => x.photos), ...(nt.data ?? []).flatMap((x) => x.photos), ...ms.sheets.flatMap((x) => x.photos)])];
      return paths.length ? ((await supabase.storage.from("project-photos").createSignedUrls(paths, 600)).data ?? []) : [];
    }),
    // the success partner's reward on this project (internal: costs.view)
    can(session, "costs.view") ? loadContractCommission(session, c.id) : Promise.resolve(null),
    // the site (this project's own pin, else the client's) — projects.view is enough
    // this project's client: a short map link not read yet is read first (≤ 3 s), so check-in works
    readPendingPins({ orgId, clientIds: [c.client_id], budgetMs: 3000 }).then(() => loadProjectSites(supabase, orgId)),
    measuresP,
    // subcontractors on this project: their agreements, work and payments (purchases.view under RLS)
    can(session, "purchases.view") ? loadProjectSubs(supabase, c.id) : Promise.resolve([]),
  ]);
  const extraDays = (addenda ?? []).reduce((s, a) => s + a.extra_days, 0);
  const own = costs?.find((x) => x.id === c.id);
  const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const photo = (p: string) => ({ path: p, url: url.get(p) ?? null });
  return {
    contract: { id: c.id, number: c.number, service: c.service, start_date: c.start_date, duration_days: c.duration_days, warranty_months: c.warranty_months, accepted_at: c.accepted_at },
    client: client ?? { name: "—", phone: null, city: null, district: null, location_url: null },
    site: sites.get(c.id)?.site ?? null,
    siteOwn: sites.get(c.id)?.own ?? false,
    siteSource: sites.get(c.id)?.source ?? null,
    // where the project is (its survey's own place, else the client's address)
    place: sites.has(c.id) ? { city: sites.get(c.id)!.city, district: sites.get(c.id)!.district } : null,
    canSetSite: can(session, "projects.manage"),
    canOpenClient: can(session, "clients.view"),
    orgName: session.organization.name,
    stages: (stages ?? []).map((s) => ({
      id: s.id, seq: s.seq, name: s.name, status: s.status, progress: s.progress, is_final: s.is_final, payment_event: s.payment_event,
      report: s.report, report_ai: s.report_ai, sent_at: s.sent_at, confirmed_at: s.confirmed_at, confirmed_name: s.confirmed_name, signed: !!s.confirmed_signature,
      updates: (updates ?? []).filter((u) => u.stage_id === s.id).map((u) => ({ id: u.id, progress: u.progress, note: u.note, photos: u.photos.map(photo), created_at: u.created_at, visible: u.visible_to_client })),
    })),
    visits: (visits ?? []).map((v) => ({ ...v, latitude: v.latitude == null ? null : Number(v.latitude), longitude: v.longitude == null ? null : Number(v.longitude), accuracy_m: v.accuracy_m == null ? null : Number(v.accuracy_m), by: v.created_by ? (who.get(v.created_by) ?? null) : null })),
    notes: (notes ?? []).map((n) => ({ ...n, photos: n.photos.map(photo) })),
    payments: (payments ?? []).map((p) => ({ seq: p.seq, label: p.label, amount: Number(p.amount), due_event: p.due_event, status: p.status, kind: p.kind, adjust: Number(p.measure_adjust ?? 0) })),
    measure: {
      basis: measures.basis,
      sheets: measures.sheets.map((m) => ({ ...m, photos: m.photos.map(photo) })),
      owed: measurementTotals(measures.sheets).owed,
    },
    canRefund: can(session, "finance.manage"),
    subcontractors: subs,
    addenda: (addenda ?? []).map((a) => ({ ...a, total: Number(a.total) })),
    // delivery: the same date as the contract page (start + duration + accepted addenda days)
    dates: { start: c.start_date, delivery: deliveryDate(c.start_date, c.duration_days, extraDays), extraDays, warrantyEnd },
    // the estimate covers materials only: compare it with actual materials; the full actual apart
    cost: own ? { estimated: own.estimated, materials: own.materialsActual, actual: own.actual, reward } : null,
    bookTeam,
    openMaintenance: openMaintenance ?? 0,
    canSchedule: can(session, "schedule.view"),
    canManage: can(session, "projects.manage"),
    canPurchase: can(session, "purchases.manage") && can(session, "quotes.view"),
    canViewContract: can(session, "quotes.view"),
    canOpenCosts: can(session, "costs.view") && can(session, "purchases.view"),
    aiEnabled: aiConfigured(),
  };
}

/** Final handover certificate (print): only once the client has signed the final stage. */
export async function loadCertificate(session: SessionContext, number: string) {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: c } = await supabase.from("contracts").select("id, number, service, start_date, warranty_months, client_id, total, client_id_number").eq("organization_id", orgId).eq("number", number).maybeSingle();
  if (!c) notFound();
  const [{ data: client }, { data: final }] = await Promise.all([
    supabase.from("clients").select("name, phone, city, district, id_number").eq("id", c.client_id).maybeSingle(),
    supabase.from("project_stages").select("confirmed_at, confirmed_name, confirmed_signature, confirmed_ip").eq("contract_id", c.id).eq("is_final", true).eq("status", "confirmed").maybeSingle(),
  ]);
  if (!final) notFound();
  // the certificate names the client by the ID number the contract was signed with
  return { contract: { ...c, total: Number(c.total) }, client: client ? { ...client, id_number: c.client_id_number ?? client.id_number } : client, final };
}

async function loadProjectSubs(supabase: Awaited<ReturnType<typeof createClient>>, contractId: string) {
  const { data: ags } = await supabase.from("subcontractor_agreements").select("id, subcontractor_id, scope, basis, rate, quantity_m2").eq("contract_id", contractId);
  const ids = (ags ?? []).map((g) => g.id);
  if (!ids.length) return [];
  const [{ data: subs }, { data: work }, { data: pays }] = await Promise.all([
    supabase.from("subcontractors").select("id, number, name").in("id", [...new Set((ags ?? []).map((g) => g.subcontractor_id))]),
    supabase.from("subcontractor_work").select("agreement_id, amount").in("agreement_id", ids),
    supabase.from("subcontractor_payments").select("agreement_id, amount").in("agreement_id", ids),
  ]);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return (ags ?? []).map((g) => {
    const sub = (subs ?? []).find((x) => x.id === g.subcontractor_id);
    return {
      number: sub?.number ?? "", name: sub?.name ?? "—", scope: g.scope,
      agreed: r2(g.basis === "lump" ? Number(g.rate) : Number(g.rate) * Number(g.quantity_m2 ?? 0)),
      earned: r2((work ?? []).filter((w) => w.agreement_id === g.id).reduce((a, w) => a + Number(w.amount), 0)),
      paid: r2((pays ?? []).filter((x) => x.agreement_id === g.id).reduce((a, x) => a + Number(x.amount), 0)),
    };
  });
}
