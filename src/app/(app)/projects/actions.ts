"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrors, type ActionResult } from "@/lib/actions";
import { draftStageReport } from "@/lib/ai/stage-report";
import { can, getSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { visitRefusal } from "@/lib/geo";
import { linkCoords } from "@/lib/geo-server";

const id = z.uuid();
const MAX_BYTES = 4 * 1024 * 1024;
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

async function authorize() {
  const session = await getSession();
  if (!can(session, "projects.manage")) return { ok: false, error: "noAccess" } as const;
  return { supabase: await createClient(), orgId: session.organization.id, userId: session.userId, session };
}
type Ctx = Exclude<Awaited<ReturnType<typeof authorize>>, { ok: false }>;
const isCtx = (c: Awaited<ReturnType<typeof authorize>>): c is Ctx => !("ok" in c);

function fail(error: { code?: string; message?: string } | null, what: string): ActionResult<never> {
  console.error(`[projects] ${what} failed`, { code: error?.code });
  if (error?.code === "42501") return { ok: false, error: "noAccess" };
  if (error?.message?.includes("accepts the contract")) return { ok: false, error: "notAccepted" };
  return { ok: false, error: "error" };
}
const done = <T,>(data?: T): ActionResult<T> => {
  revalidatePath("/projects", "layout");
  return { ok: true, data };
};

/** The contract must be this organization's and accepted. */
async function contractOf(ctx: Ctx, contractId: string) {
  const { data } = await ctx.supabase.from("contracts").select("id, status, service").eq("id", contractId).eq("organization_id", ctx.orgId).maybeSingle();
  return data?.status === "accepted" ? data : null;
}

export async function checkIn(input: unknown): Promise<ActionResult> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = z
    .object({
      contract_id: id,
      latitude: z.number().min(-90).max(90).nullable(),
      longitude: z.number().min(-180).max(180).nullable(),
      accuracy_m: z.number().min(0).max(100_000).nullable(),
      note: z.string().trim().max(500).nullable(),
    })
    .strict()
    .refine((v) => (v.latitude == null) === (v.longitude == null))
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const { error } = await ctx.supabase.from("site_visits").insert({
    organization_id: ctx.orgId, contract_id: v.contract_id, latitude: v.latitude, longitude: v.longitude,
    accuracy_m: v.accuracy_m == null ? null : Math.round(v.accuracy_m * 10) / 10, note: v.note || null,
  });
  if (error) {
    // check-in only on site (owner, Nov 2026): the database says why — far (with the distance), no site, no / poor position
    const refused = visitRefusal(error.message);
    if (refused) return { ok: false, error: "meters" in refused ? `${refused.key}:${refused.meters}` : refused.key };
    return fail(error, "check in");
  }
  return done();
}

/** «موقع هذا المشروع» (projects.manage): its own pin (a client with two villas); null = back to the client's. */
export async function saveProjectSite(input: unknown): Promise<ActionResult> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = z
    .object({ contract_id: id, latitude: z.number().min(-90).max(90).nullable(), longitude: z.number().min(-180).max(180).nullable() })
    .strict()
    .refine((v) => (v.latitude == null) === (v.longitude == null))
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  if (!(await contractOf(ctx, v.contract_id))) return { ok: false, error: "notAccepted" };
  const { error } =
    v.latitude == null || v.longitude == null
      ? await ctx.supabase.from("project_sites").delete().eq("contract_id", v.contract_id).eq("organization_id", ctx.orgId)
      : await ctx.supabase.from("project_sites").upsert({
          contract_id: v.contract_id, organization_id: ctx.orgId,
          latitude: Math.round(v.latitude * 1e6) / 1e6, longitude: Math.round(v.longitude * 1e6) / 1e6,
        });
  if (error) return fail(error, "save site");
  return done();
}

/** «من الرابط» on the project page (projects.manage). */
export async function readSiteLink(input: unknown): Promise<ActionResult<{ lat: number; lng: number } | null>> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = z.object({ url: z.url({ protocol: /^https$/ }).max(500) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "urlInvalid" };
  const r = await linkCoords(ctx.userId, parsed.data.url);
  if (r.rateLimited) return { ok: false, error: "rateLimited" };
  return { ok: true, data: r.pin };
}

/** One site photo (already shrunk to JPEG in the browser) → private bucket. */
export async function uploadPhoto(fd: FormData): Promise<ActionResult<{ path: string }>> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const contractId = String(fd.get("contract_id") ?? "");
  const file = fd.get("file");
  if (!id.safeParse(contractId).success || !(file instanceof File) || file.size === 0) return { ok: false, error: "fileMissing" };
  if (file.size > MAX_BYTES) return { ok: false, error: "fileTooLarge" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isJpeg(bytes)) return { ok: false, error: "fileType" };
  if (!(await contractOf(ctx, contractId))) return { ok: false, error: "notAccepted" };
  const path = `${ctx.orgId}/${contractId}/${randomUUID()}.jpg`;
  const { error } = await ctx.supabase.storage.from("project-photos").upload(path, bytes, { contentType: "image/jpeg", upsert: false });
  if (error) {
    console.error("[projects] photo upload failed");
    return { ok: false, error: "error" };
  }
  return { ok: true, data: { path } };
}

export async function saveProgress(input: unknown): Promise<ActionResult> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = z
    .object({ stage_id: id, progress: z.number().int().min(0).max(100), note: z.string().trim().max(1000).nullable(), photos: z.array(z.string().max(200)).max(12), visible: z.boolean() })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const { data: stage } = await ctx.supabase.from("project_stages").select("id, contract_id, status").eq("id", v.stage_id).eq("organization_id", ctx.orgId).maybeSingle();
  if (!stage || stage.status === "confirmed") return { ok: false, error: "invalid" };
  const { error } = await ctx.supabase.from("progress_updates").insert({
    organization_id: ctx.orgId, contract_id: stage.contract_id, stage_id: stage.id, progress: v.progress, note: v.note || null, photos: v.photos, visible_to_client: v.visible,
  });
  if (error) return fail(error, "progress");
  const { error: e2 } = await ctx.supabase
    .from("project_stages")
    .update({ progress: v.progress, ...(stage.status === "pending" ? { status: "in_progress" as const } : {}) })
    .eq("id", stage.id);
  if (e2) return fail(e2, "stage progress");
  return done();
}

/** AI draft of the client report for a stage, from its latest photos and notes. */
export async function draftReport(input: unknown): Promise<ActionResult<{ text: string }>> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = z.object({ stage_id: id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const limit = await rateLimit(`ai:report:${ctx.userId}`, 30, 3600);
  if (limit !== "ok") return { ok: false, error: limit === "limited" ? "rateLimited" : "error" };
  const { data: stage } = await ctx.supabase.from("project_stages").select("id, name, progress, contract_id").eq("id", parsed.data.stage_id).eq("organization_id", ctx.orgId).maybeSingle();
  if (!stage) return { ok: false, error: "invalid" };
  const [{ data: contract }, { data: updates }] = await Promise.all([
    ctx.supabase.from("contracts").select("service").eq("id", stage.contract_id).maybeSingle(),
    ctx.supabase.from("progress_updates").select("note, photos").eq("stage_id", stage.id).eq("visible_to_client", true).order("created_at", { ascending: false }).limit(10),
  ]);
  const photoPaths = (updates ?? []).flatMap((u) => u.photos).slice(0, 4);
  const photos: Uint8Array[] = [];
  for (const p of photoPaths) {
    const { data } = await ctx.supabase.storage.from("project-photos").download(p);
    if (data) photos.push(new Uint8Array(await data.arrayBuffer()));
  }
  const service = { gypsum: "جبس بورد", interior: "دهانات داخلية", exterior: "دهانات خارجية" }[contract?.service ?? "gypsum"] ?? "";
  const r = await draftStageReport({ service, stage: stage.name, progress: stage.progress, notes: (updates ?? []).map((u) => u.note).filter((n): n is string => !!n), photos });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, data: { text: r.text } };
}

/** Send a finished stage to the client page for confirmation. */
export async function sendStage(input: unknown): Promise<ActionResult> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = z.object({ stage_id: id, report: z.string().trim().min(1, "required").max(4000), ai: z.boolean() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { error } = await ctx.supabase
    .from("project_stages")
    .update({ status: "awaiting_client", progress: 100, report: parsed.data.report, report_ai: parsed.data.ai, sent_at: new Date().toISOString() })
    .eq("id", parsed.data.stage_id)
    .eq("organization_id", ctx.orgId)
    .in("status", ["pending", "in_progress", "awaiting_client"]);
  if (error) return fail(error, "send stage");
  return done();
}

export async function updateNote(input: unknown): Promise<ActionResult> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = z.object({ id, status: z.enum(["seen", "resolved"]), reply: z.string().trim().max(2000).nullable() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await ctx.supabase.from("client_notes").update({ status: parsed.data.status, reply: parsed.data.reply || null }).eq("id", parsed.data.id).eq("organization_id", ctx.orgId);
  if (error) return fail(error, "note");
  return done();
}
