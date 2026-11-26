"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrors, type ActionResult } from "@/lib/actions";
import { can, getSession } from "@/lib/auth/session";
import type { Permission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { num, optionalDate, optionalText } from "@/lib/validation/numbers";
import { draftSurvey, type SurveyPhoto } from "@/lib/ai/survey";
import { rateLimit } from "@/lib/rate-limit";
import { cleanDraft } from "@/lib/survey/ai-draft";
import { bulkRoomsSchema, surveyTotalsSchema } from "@/lib/survey/schema";
import { deleteError } from "@/lib/deletion";
import { readPlan, type PlanTile } from "@/lib/ai/plan";
import { readFacade } from "@/lib/ai/facade";
import { cleanFacade, elevationSheetSchema, printedLevels, facadesSchema, facadesTotal, type ElevationSheet, type Facade } from "@/lib/survey/facade";
import { cleanPlanDraft, planSheetSchema, PLAN_SHEET_MAX_BYTES, PLAN_TILE_MAX_BYTES, type PlanSheet } from "@/lib/survey/plan";
import { clientDbError } from "@/lib/marketers";
import { pinToSave, type LatLng } from "@/lib/geo";
import { linkCoords } from "@/lib/geo-server";
import { reversePlace, type Place } from "@/lib/geo-place";

type Ctx = { orgId: string; userId: string; supabase: Awaited<ReturnType<typeof createClient>> };
async function authorize(perm: Permission): Promise<Ctx | ActionResult> {
  const session = await getSession();
  if (!can(session, perm)) return { ok: false, error: "noAccess" };
  return { orgId: session.organization.id, userId: session.userId, supabase: await createClient() };
}
const isCtx = (x: Ctx | ActionResult): x is Ctx => "orgId" in x;
function dbError(error: { code?: string; message: string } | null): ActionResult | null {
  if (!error) return null;
  const partner = clientDbError(error);
  if (partner) return { ok: false, error: partner };
  if (error.code === "42501") return { ok: false, error: "noAccess" };
  if (error.code === "23503") return { ok: false, error: "inUse" };
  console.error("[clients] db error", { code: error.code });
  return { ok: false, error: "error" };
}
const done = <T,>(data?: T): ActionResult<T> => {
  revalidatePath("/clients", "layout");
  return { ok: true, data };
};
const id = z.uuid();
const optionalTime = z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable());
const digits = (v: unknown) => (typeof v === "string" ? v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\D/g, "") : v);

// --- Clients -------------------------------------------------------------------------

const clientSchema = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(2, "required").max(160),
    // Saudi mobile: 05xxxxxxxx or 9665xxxxxxxx → stored as 9665xxxxxxxx
    phone: z.preprocess((v) => {
      const d = digits(v);
      if (typeof d !== "string" || d === "") return null;
      if (/^05\d{8}$/.test(d)) return `966${d.slice(1)}`;
      if (/^5\d{8}$/.test(d)) return `966${d}`;
      return d;
    }, z.string().regex(/^\d{8,15}$/, "phoneInvalid").nullable()),
    city: optionalText(80),
    district: optionalText(80),
    // national ID / iqama / CR — needed to name the second party in the contract
    id_number: z.preprocess((v) => { const d = digits(v); return typeof d === "string" && d !== "" ? d : null; }, z.string().regex(/^\d{10}$/, "idInvalid").nullable()),
    location_url: z.preprocess((v) => (v === "" ? null : v), z.url({ protocol: /^https$/, error: "urlInvalid" }).max(500).nullable()),
    notes: optionalText(2000),
    /** «جاء عن طريق» — the success partner (same organization: checked by the database) */
    marketer_id: z.preprocess((v) => (v === "" ? null : v), id.nullable()).optional(),
    /** the site pin (map / phone position); null = not set → read from the map link when it has one */
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    /** map = the pin as set · auto = read it from the link · none = cleared (see pinToSave) */
    pin_source: z.enum(["map", "auto", "none"]).optional(),
  })
  .strict()
  .refine((v) => (v.latitude == null) === (v.longitude == null), { path: ["latitude"], message: "pinInvalid" });

/** «من الرابط»: the pin of a Google Maps link (also a short one) — shown on the map before saving. */
export async function readMapLink(input: unknown): Promise<ActionResult<LatLng | null>> {
  const ctx = await authorize("clients.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = z.object({ url: z.url({ protocol: /^https$/ }).max(500) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "urlInvalid" };
  const r = await linkCoords(ctx.userId, parsed.data.url);
  if (r.rateLimited) return { ok: false, error: "rateLimited" };
  return { ok: true, data: r.pin };
}

export async function saveClient(input: unknown): Promise<ActionResult<{ number: string }>> {
  const ctx = await authorize("clients.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: clientId, latitude, longitude, pin_source, ...rest } = parsed.data;
  const formPin = latitude != null && longitude != null ? { lat: latitude, lng: longitude } : null;
  // older callers without pin_source: a pin sent = map, none = read the link
  const source = pin_source ?? (formPin ? "map" : "auto");
  const pin = pinToSave({ source, pin: formPin }, source === "auto" ? (await linkCoords(ctx.userId, rest.location_url)).pin : null);
  // a link that couldn't be read now (short link, Google slow, limit) is read later by the server (geo-pins)
  const data = { ...rest, latitude: pin ? Math.round(pin.lat * 1e6) / 1e6 : null, longitude: pin ? Math.round(pin.lng * 1e6) / 1e6 : null, pin_pending: source === "auto" && !pin && !!rest.location_url?.trim() };
  const q = clientId
    ? ctx.supabase.from("clients").update(data).eq("id", clientId).eq("organization_id", ctx.orgId).select("number").single()
    : ctx.supabase.from("clients").insert({ ...data, organization_id: ctx.orgId }).select("number").single();
  const { data: row, error } = await q;
  return dbError(error) ?? done({ number: row!.number });
}

// --- Surveys -------------------------------------------------------------------------

const pinFields = {
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  site_city: optionalText(80),
  site_district: optionalText(80),
};
const pinPair = (v: { latitude: number | null; longitude: number | null }) => (v.latitude == null) === (v.longitude == null);
/** «موقع ثاني» names its place (city or district) — the contract says where the project is */
const placeNamed = (v: { latitude?: number | null; site_city?: string | null; site_district?: string | null }) => v.latitude == null || !!(v.site_city?.trim() || v.site_district?.trim());
const round6 = (x: number | null) => (x == null ? null : Math.round(x * 1e6) / 1e6);
/** «نفس موقع العميل» = no pin and no place of its own */
const sitePart = (v: { latitude: number | null; longitude: number | null; site_city?: string | null; site_district?: string | null }) =>
  v.latitude == null
    ? { latitude: null, longitude: null, site_city: null, site_district: null }
    : { latitude: round6(v.latitude), longitude: round6(v.longitude), site_city: v.site_city ?? null, site_district: v.site_district ?? null };

export async function createSurvey(input: unknown): Promise<ActionResult<{ number: string }>> {
  const ctx = await authorize("clients.manage");
  if (!isCtx(ctx)) return ctx;
  // booked before the visit (owner): date + optional time, and «the client's site» or another one
  const parsed = z
    .object({ client_id: id, mode: z.enum(["total", "rooms"]), visit_date: optionalDate.optional(), visit_time: optionalTime.optional(), ...pinFields })
    .partial({ latitude: true, longitude: true, site_city: true, site_district: true })
    .strict()
    .refine((v) => pinPair({ latitude: v.latitude ?? null, longitude: v.longitude ?? null }))
    .refine(placeNamed, { path: ["site_city"], message: "placeRequired" })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  const { data, error } = await ctx.supabase
    .from("surveys")
    .insert({
      organization_id: ctx.orgId, client_id: v.client_id, mode: v.mode,
      // not sent = today; cleared on purpose = no date yet
      visit_date: v.visit_date === undefined ? today : v.visit_date, visit_time: v.visit_time ?? null,
      ...sitePart({ latitude: v.latitude ?? null, longitude: v.longitude ?? null, site_city: v.site_city ?? null, site_district: v.site_district ?? null }),
    })
    .select("number")
    .single();
  return dbError(error) ?? done({ number: data!.number });
}

const surveySchema = z
  .object({
    id,
    title: optionalText(160),
    mode: z.enum(["total", "rooms"]),
    visit_date: optionalDate,
    visit_time: optionalTime.optional(),
    notes: optionalText(4000),
    totals: surveyTotalsSchema,
  })
  .strict();

export async function saveSurvey(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("clients.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = surveySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: surveyId, ...data } = parsed.data;
  const { error } = await ctx.supabase.from("surveys").update(data).eq("id", surveyId).eq("organization_id", ctx.orgId);
  return dbError(error) ?? done();
}

/** The survey's site: its own pin (a second villa) or null = the client's site. */
export async function saveSurveySite(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("clients.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = z.object({ id, ...pinFields }).strict().refine(pinPair).refine(placeNamed, { path: ["site_city"], message: "placeRequired" }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { id: surveyId, ...v } = parsed.data;
  const { error } = await ctx.supabase.from("surveys").update(sitePart(v)).eq("id", surveyId).eq("organization_id", ctx.orgId);
  return dbError(error) ?? done();
}

/** City and district of a pin (OpenStreetMap reverse lookup, coordinates only) — a suggestion for the form. */
export async function readPlace(input: unknown): Promise<ActionResult<Place | null>> {
  const ctx = await authorize("clients.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if ((await rateLimit(`place:${ctx.userId}`, 60, 3600)) !== "ok") return { ok: false, error: "rateLimited" };
  return { ok: true, data: await reversePlace(parsed.data, (u, init) => fetch(u, init)) };
}

const roomSchema = z
  .object({
    id: id.optional(),
    survey_id: id,
    name: z.string().trim().min(1, "required").max(80),
    unit_label: optionalText(60),
    length_m: num({ min: 0.01, max: 200 }),
    width_m: num({ min: 0.01, max: 200 }),
    height_m: num({ min: 0.01, max: 30 }),
    openings_m2: num({ min: 0, max: 10000 }),
    gypsum_ceiling: z.boolean(),
    ceiling_board: z.enum(["normal", "moisture", "fire"]),
    paint_walls: z.boolean(),
    paint_ceiling: z.boolean(),
    wall_zone: z.enum(["normal", "wet", "decorative"]),
    c_along: z.enum(["length", "width"]).nullable().optional(),
    sort_order: z.number().int().min(0).max(10000).optional(),
  })
  .strict();

export async function saveRoom(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("clients.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = roomSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: roomId, ...data } = parsed.data;
  const { error } = roomId
    ? await ctx.supabase.from("survey_rooms").update(data).eq("id", roomId).eq("organization_id", ctx.orgId)
    : await ctx.supabase.from("survey_rooms").insert({ ...data, organization_id: ctx.orgId });
  return dbError(error) ?? done();
}

export async function deleteRoom(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("clients.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await ctx.supabase.from("survey_rooms").delete().eq("id", parsed.data.id).eq("organization_id", ctx.orgId);
  return dbError(error) ?? done();
}

// --- Deleting (owner only, Nov 2026) ----------------------------------------------------
// The database checks the owner again and refuses what must stay (contracts, the client's
// acceptance, a quote built on the survey); every deleted row is audited under the owner.

async function ownerDelete(fn: "delete_client" | "delete_survey", input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (session.role !== "owner") return { ok: false, error: "noAccess" };
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } =
    fn === "delete_client" ? await supabase.rpc("delete_client", { p_client: parsed.data.id }) : await supabase.rpc("delete_survey", { p_survey: parsed.data.id });
  if (error) {
    const key = deleteError(error);
    if (key === "error") console.error("[clients] delete failed", { code: error.code });
    return { ok: false, error: key };
  }
  // no revalidatePath: it would re-render the deleted page (404) in this response — the page
  // replaces itself with the one above, which loads fresh (dynamic pages aren't cached)
  return { ok: true };
}

/** Deletes a client with his surveys and quotes — refused if he has any contract or a quote he accepted. */
export async function deleteClient(input: unknown): Promise<ActionResult> {
  return ownerDelete("delete_client", input);
}

/** Deletes a survey with its rooms — refused while a quote is built on it. */
export async function deleteSurvey(input: unknown): Promise<ActionResult> {
  return ownerDelete("delete_survey", input);
}

/**
 * «تطبيق على عدة غرف»: the given settings for the chosen rooms of one survey, in one update (all or
 * nothing). Only rooms of that survey in this organization change (RLS + the survey filter).
 */
export async function bulkUpdateRooms(input: unknown): Promise<ActionResult<{ n: number }>> {
  const ctx = await authorize("clients.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = bulkRoomsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { survey_id, ids, patch } = parsed.data;
  const { data, error } = await ctx.supabase
    .from("survey_rooms")
    .update(patch)
    .eq("organization_id", ctx.orgId)
    .eq("survey_id", survey_id)
    .in("id", ids)
    .select("id");
  return dbError(error) ?? done({ n: data?.length ?? 0 });
}

// --- Floor plan → rooms (owner, Nov 2026) ---------------------------------------------

/**
 * One floor-plan sheet, cropped and tiled in the browser (the PDF itself never leaves the device)
 * → a rooms draft. Nothing is saved: the owner reviews the rows and adds them with saveRoom.
 * 40 sheet reads per hour per user (a failed sheet is retried once); the drawing is never stored or logged.
 */
export async function readPlanAi(fd: FormData): Promise<ActionResult<ReturnType<typeof cleanPlanDraft>>> {
  const session = await getSession();
  if (!can(session, "clients.manage")) return { ok: false, error: "noAccess" };
  const meta = fd.get("meta");
  let sheet: PlanSheet;
  try {
    const parsed = planSheetSchema.safeParse(typeof meta === "string" && meta.length < 400_000 ? JSON.parse(meta) : null);
    if (!parsed.success) return { ok: false, error: "invalid" };
    sheet = parsed.data;
  } catch {
    return { ok: false, error: "invalid" };
  }
  const files = fd.getAll("tiles").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length !== sheet.tiles.length) return { ok: false, error: "invalid" };
  if (files.reduce((n, f) => n + f.size, 0) > PLAN_SHEET_MAX_BYTES) return { ok: false, error: "fileTooLarge" };
  const tiles: PlanTile[] = [];
  for (const f of files) {
    if (f.size > PLAN_TILE_MAX_BYTES) return { ok: false, error: "fileTooLarge" };
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (sniffPhoto(bytes) !== "image/jpeg") return { ok: false, error: "fileType" };
    tiles.push({ bytes });
  }
  const supabase = await createClient();
  const { data: survey } = await supabase.from("surveys").select("id").eq("id", sheet.survey_id).eq("organization_id", session.organization.id).maybeSingle();
  if (!survey) return { ok: false, error: "invalid" };
  const limit = await rateLimit(`ai:plan:${session.userId}`, 40, 3600); // a sheet may be read twice (automatic retry)
  if (limit !== "ok") return { ok: false, error: limit === "limited" ? "rateLimited" : "aiFailed" };
  const r = await readPlan(sheet, tiles);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, data: cleanPlanDraft(r.draft, sheet, sheet.title) };
}

/**
 * «قراءة الواجهات من المخطط»: one elevation (tiles + printed text + line positions, in metres) → its
 * parts by finish and openings, a draft for review (clients.manage; same limits as the floor plans).
 */
export async function readFacadeAi(fd: FormData): Promise<ActionResult<Facade>> {
  const session = await getSession();
  if (!can(session, "clients.manage")) return { ok: false, error: "noAccess" };
  const meta = fd.get("meta");
  let sheet: ElevationSheet;
  try {
    const parsed = elevationSheetSchema.safeParse(typeof meta === "string" && meta.length < 400_000 ? JSON.parse(meta) : null);
    if (!parsed.success) return { ok: false, error: "invalid" };
    sheet = parsed.data;
  } catch {
    return { ok: false, error: "invalid" };
  }
  const files = fd.getAll("tiles").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length !== sheet.tiles.length) return { ok: false, error: "invalid" };
  if (files.reduce((n, f) => n + f.size, 0) > PLAN_SHEET_MAX_BYTES) return { ok: false, error: "fileTooLarge" };
  const tiles: PlanTile[] = [];
  for (const f of files) {
    if (f.size > PLAN_TILE_MAX_BYTES) return { ok: false, error: "fileTooLarge" };
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (sniffPhoto(bytes) !== "image/jpeg") return { ok: false, error: "fileType" };
    tiles.push({ bytes });
  }
  const supabase = await createClient();
  const { data: survey } = await supabase.from("surveys").select("id").eq("id", sheet.survey_id).eq("organization_id", session.organization.id).maybeSingle();
  if (!survey) return { ok: false, error: "invalid" };
  // the same hourly budget as the floor plans (an elevation may be read twice: automatic retry)
  const limit = await rateLimit(`ai:plan:${session.userId}`, 40, 3600);
  if (limit !== "ok") return { ok: false, error: limit === "limited" ? "rateLimited" : "aiFailed" };
  const r = await readFacade(sheet, tiles);
  if (!r.ok) return { ok: false, error: r.error };
  // a height counts as measured only when both its levels are printed on this sheet
  return { ok: true, data: cleanFacade(r.draft, printedLevels(sheet.words)) };
}

/** The reviewed façades → the survey (kept for review) and its façade area = their paint area; null removes the rows (the area stays). */
export async function saveFacades(input: unknown): Promise<ActionResult<{ facade: number }>> {
  const ctx = await authorize("clients.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = z.object({ id, facades: facadesSchema.nullable() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  // «إزالة قراءة الواجهات»: the rows go, the typed façade area stays as it is
  if (parsed.data.facades === null) {
    const { error } = await ctx.supabase.from("surveys").update({ facades: null }).eq("id", parsed.data.id).eq("organization_id", ctx.orgId);
    return dbError(error) ?? done({ facade: -1 });
  }
  const { data: sv, error: readError } = await ctx.supabase.from("surveys").select("totals").eq("id", parsed.data.id).eq("organization_id", ctx.orgId).maybeSingle();
  if (readError || !sv) return dbError(readError) ?? { ok: false, error: "invalid" };
  // the area is computed here from the rows, never taken from the browser
  const facade = facadesTotal(parsed.data.facades);
  const totals = { ...((sv.totals ?? {}) as Record<string, unknown>), facade };
  const { error } = await ctx.supabase.from("surveys").update({ facades: parsed.data.facades, totals }).eq("id", parsed.data.id).eq("organization_id", ctx.orgId);
  return dbError(error) ?? done({ facade });
}

// --- AI survey draft (§3.2 / §8.1) ----------------------------------------------------

const MAX_PHOTO = 4 * 1024 * 1024;
function sniffPhoto(b: Uint8Array): SurveyPhoto["mediaType"] | null {
  const at = (sig: number[], o = 0) => sig.every((x, i) => b[o + i] === x);
  if (at([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at([0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

/**
 * Voice notes (already transcribed by the browser) and/or up to 4 photos →
 * a measurements draft. Nothing is saved: the supervisor reviews and adds rooms.
 * Rate-limited (30 per hour per user); the notes and photos are never stored or logged.
 */
export async function draftSurveyAi(fd: FormData): Promise<ActionResult<ReturnType<typeof cleanDraft>>> {
  const session = await getSession();
  if (!can(session, "clients.manage")) return { ok: false, error: "noAccess" };
  const surveyId = id.safeParse(fd.get("survey_id"));
  const text = fd.get("text");
  if (!surveyId.success || (text !== null && typeof text !== "string") || (typeof text === "string" && text.length > 6000)) return { ok: false, error: "invalid" };
  const files = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > 4) return { ok: false, error: "tooManyPhotos" };
  if (!(text ?? "").toString().trim() && !files.length) return { ok: false, error: "invalid" };
  const photos: SurveyPhoto[] = [];
  for (const f of files) {
    if (f.size > MAX_PHOTO) return { ok: false, error: "fileTooLarge" };
    const bytes = new Uint8Array(await f.arrayBuffer());
    const mediaType = sniffPhoto(bytes);
    if (!mediaType) return { ok: false, error: "fileType" };
    photos.push({ bytes, mediaType });
  }
  const supabase = await createClient();
  // the survey must be one this user can see (RLS); its rooms give the usual height
  const { data: survey } = await supabase.from("surveys").select("id").eq("id", surveyId.data).eq("organization_id", session.organization.id).maybeSingle();
  if (!survey) return { ok: false, error: "invalid" };
  const limit = await rateLimit(`ai:survey:${session.userId}`, 30, 3600);
  if (limit !== "ok") return { ok: false, error: limit === "limited" ? "rateLimited" : "aiFailed" };
  const r = await draftSurvey((text ?? "").toString(), photos);
  if (!r.ok) return { ok: false, error: r.error };
  const { data: last } = await supabase.from("survey_rooms").select("height_m").eq("survey_id", survey.id).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  return { ok: true, data: cleanDraft(r.draft, last ? Number(last.height_m) : 3) };
}
