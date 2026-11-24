"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import type { ActionResult } from "@/lib/actions";
import { NUMBER_RE, TOKEN_RE } from "@/lib/portal";
import { quoteDecisionError } from "@/lib/portal-flow";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { runBackground } from "@/lib/background";
import { createAdminClient } from "@/lib/supabase/admin";

const acceptSchema = z
  .object({
    number: z.string().regex(NUMBER_RE),
    token: z.string().regex(TOKEN_RE),
    name: z.string().trim().min(2, "required").max(160),
    agree: z.literal(true),
    // optional drawn signature as a PNG data URL (size-limited)
    signature: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(200_000).nullable(),
    /** the option the client chose (contracts offered with options) */
    version: z.number().int().min(1).max(1000).nullable().optional(),
  })
  .strict();

/** The client accepts the quote and contract from their page. */
export async function acceptPortal(input: unknown): Promise<ActionResult> {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  const ip = await clientIp();
  if ((await rateLimit(`portal:accept:${ip}`, 10, 600)) !== "ok") return { ok: false, error: "rateLimited" };
  const ua = (await headers()).get("user-agent") ?? "";
  const v = parsed.data;
  const { data, error } = await createAdminClient().rpc("portal_accept", {
    p_number: v.number, p_token: v.token, p_name: v.name, p_signature: v.signature, p_ip: ip, p_user_agent: ua, p_version: v.version ?? null,
  });
  if (error) {
    if (error.code === "22023" && /choose an option/.test(error.message)) return { ok: false, error: "chooseOption" };
    console.error("[portal] accept failed", { code: error.code });
    return { ok: false, error: "error" };
  }
  if (data) after(runBackground);
  return data ? { ok: true } : { ok: false, error: "linkInvalid" };
}

const confirmSchema = z
  .object({
    number: z.string().regex(NUMBER_RE),
    token: z.string().regex(TOKEN_RE),
    stage_id: z.uuid(),
    name: z.string().trim().min(2, "required").max(160),
    signature: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(200_000).nullable(),
  })
  .strict();

/** The client confirms receipt of a stage (the final one with a signature = handover certificate). */
export async function confirmStagePortal(input: unknown): Promise<ActionResult> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ip = await clientIp();
  if ((await rateLimit(`portal:confirm:${ip}`, 20, 600)) !== "ok") return { ok: false, error: "rateLimited" };
  const ua = (await headers()).get("user-agent") ?? "";
  const v = parsed.data;
  const { data, error } = await createAdminClient().rpc("portal_confirm_stage", {
    p_number: v.number, p_token: v.token, p_stage: v.stage_id, p_name: v.name, p_signature: v.signature, p_ip: ip, p_user_agent: ua,
  });
  if (error) {
    console.error("[portal] confirm failed", { code: error.code });
    return { ok: false, error: error.message?.includes("signature") ? "signatureRequired" : "error" };
  }
  if (data) after(runBackground);
  return data ? { ok: true } : { ok: false, error: "linkInvalid" };
}

const MAX_PHOTO = 4 * 1024 * 1024;

/** The client posts a note (with up to 6 photos, already shrunk to JPEG in the browser). */
export async function addNotePortal(fd: FormData): Promise<ActionResult> {
  const number = String(fd.get("number") ?? "");
  const token = String(fd.get("token") ?? "");
  const body = String(fd.get("body") ?? "").trim();
  const stage = String(fd.get("stage_id") ?? "");
  const files = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!NUMBER_RE.test(number) || !TOKEN_RE.test(token) || body.length < 1 || body.length > 2000 || files.length > 6) return { ok: false, error: "invalid" };
  if (stage && !z.uuid().safeParse(stage).success) return { ok: false, error: "invalid" };
  const ip = await clientIp();
  if ((await rateLimit(`portal:note:${ip}`, 10, 600)) !== "ok") return { ok: false, error: "rateLimited" };

  const admin = createAdminClient();
  // the token decides which contract the photos belong to
  const { data: ex } = await admin.rpc("portal_execution", { p_number: number, p_token: token });
  const e = ex as unknown as { org_id: string; contract_id: string } | null;
  if (!e) return { ok: false, error: "linkInvalid" };
  // notes are for accepted contracts only — check before storing any photo
  const { data: c } = await admin.from("contracts").select("status").eq("id", e.contract_id).maybeSingle();
  if (c?.status !== "accepted") return { ok: false, error: "linkInvalid" };

  const paths: string[] = [];
  for (const f of files) {
    if (f.size > MAX_PHOTO) return { ok: false, error: "fileTooLarge" };
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return { ok: false, error: "fileType" };
    const path = `${e.org_id}/${e.contract_id}/client/${randomUUID()}.jpg`;
    const { error } = await admin.storage.from("project-photos").upload(path, bytes, { contentType: "image/jpeg", upsert: false });
    if (error) {
      console.error("[portal] note photo upload failed");
      return { ok: false, error: "error" };
    }
    paths.push(path);
  }
  const { data, error } = await admin.rpc("portal_add_note", { p_number: number, p_token: token, p_stage: stage || null, p_body: body, p_photos: paths });
  if (error || !data) {
    console.error("[portal] add note failed", { code: error?.code });
    return { ok: false, error: "error" };
  }
  after(runBackground);
  return { ok: true };
}

const addendumSchema = z
  .object({
    number: z.string().regex(NUMBER_RE),
    token: z.string().regex(TOKEN_RE),
    addendum_id: z.uuid(),
    name: z.string().trim().min(2, "required").max(160),
    agree: z.literal(true),
    signature: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(200_000).nullable(),
  })
  .strict();

/** The client accepts additional works (addendum) from their page. */
export async function acceptAddendumPortal(input: unknown): Promise<ActionResult> {
  const parsed = addendumSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ip = await clientIp();
  if ((await rateLimit(`portal:addendum:${ip}`, 10, 600)) !== "ok") return { ok: false, error: "rateLimited" };
  const ua = (await headers()).get("user-agent") ?? "";
  const v = parsed.data;
  const { data, error } = await createAdminClient().rpc("portal_accept_addendum", {
    p_number: v.number, p_token: v.token, p_addendum: v.addendum_id, p_name: v.name, p_signature: v.signature, p_ip: ip, p_user_agent: ua,
  });
  if (error) {
    console.error("[portal] addendum accept failed", { code: error.code });
    return { ok: false, error: "error" };
  }
  if (data) after(runBackground);
  return data ? { ok: true } : { ok: false, error: "linkInvalid" };
}

/** The client opens a maintenance request during the warranty (text + up to 6 photos, JPEG from the browser). */
export async function addMaintenancePortal(fd: FormData): Promise<ActionResult> {
  const number = String(fd.get("number") ?? "");
  const token = String(fd.get("token") ?? "");
  const body = String(fd.get("body") ?? "").trim();
  const files = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!NUMBER_RE.test(number) || !TOKEN_RE.test(token) || body.length < 1 || body.length > 2000 || files.length > 6) return { ok: false, error: "invalid" };
  const ip = await clientIp();
  if ((await rateLimit(`portal:maint:${ip}`, 6, 600)) !== "ok") return { ok: false, error: "rateLimited" };

  const admin = createAdminClient();
  const { data: w } = await admin.rpc("portal_warranty", { p_number: number, p_token: token });
  const x = w as unknown as { org_id: string; contract_id: string; active: boolean } | null;
  if (!x) return { ok: false, error: "linkInvalid" };
  if (!x.active) return { ok: false, error: "warrantyEnded" };

  const paths: string[] = [];
  for (const f of files) {
    if (f.size > MAX_PHOTO) return { ok: false, error: "fileTooLarge" };
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return { ok: false, error: "fileType" };
    const path = `${x.org_id}/${x.contract_id}/client/${randomUUID()}.jpg`;
    const { error } = await admin.storage.from("project-photos").upload(path, bytes, { contentType: "image/jpeg", upsert: false });
    if (error) {
      console.error("[portal] maintenance photo upload failed");
      return { ok: false, error: "error" };
    }
    paths.push(path);
  }
  const { data, error } = await admin.rpc("portal_add_maintenance", { p_number: number, p_token: token, p_body: body, p_photos: paths });
  if (error || !data) {
    console.error("[portal] maintenance request failed", { code: error?.code });
    return { ok: false, error: "error" };
  }
  after(runBackground);
  return { ok: true, message: data };
}

/** The client confirms a maintenance request was fixed. */
export async function confirmMaintenancePortal(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ number: z.string().regex(NUMBER_RE), token: z.string().regex(TOKEN_RE), request_id: z.uuid() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ip = await clientIp();
  if ((await rateLimit(`portal:maintok:${ip}`, 20, 600)) !== "ok") return { ok: false, error: "rateLimited" };
  const { data, error } = await createAdminClient().rpc("portal_confirm_maintenance", { p_number: parsed.data.number, p_token: parsed.data.token, p_request: parsed.data.request_id });
  if (error) {
    console.error("[portal] maintenance confirm failed", { code: error.code });
    return { ok: false, error: "error" };
  }
  return data ? { ok: true } : { ok: false, error: "linkInvalid" };
}

// --- The quote stage (one link for every stage; owner, Nov 2026) -------------------------------

const quoteRef = { number: z.string().regex(NUMBER_RE), token: z.string().regex(TOKEN_RE) };

/** A refused answer → the client's message (never the database text). */
function quoteRefused(error: { code?: string; message?: string }, what: string): ActionResult {
  const why = quoteDecisionError(error);
  if (why) return { ok: false, error: why };
  console.error(`[portal] quote ${what} failed`, { code: error.code });
  return { ok: false, error: "error" };
}

const acceptQuoteSchema = z
  .object({
    ...quoteRef,
    name: z.string().trim().min(2, "required").max(160),
    agree: z.literal(true),
    /** the option the client chose (quotes offered with options) */
    version: z.number().int().min(1).max(1000).nullable().optional(),
  })
  .strict();

/** The client accepts the quote (name; the option when several are offered). Prices don't change. */
export async function acceptQuotePortal(input: unknown): Promise<ActionResult> {
  const parsed = acceptQuoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ip = await clientIp();
  if ((await rateLimit(`portal:quote:${ip}`, 10, 600)) !== "ok") return { ok: false, error: "rateLimited" };
  const ua = (await headers()).get("user-agent") ?? "";
  const v = parsed.data;
  const { data, error } = await createAdminClient().rpc("portal_accept_quote", {
    p_number: v.number, p_token: v.token, p_name: v.name, p_ip: ip, p_user_agent: ua, p_version: v.version ?? null,
  });
  if (error) return quoteRefused(error, "accept");
  if (data) after(runBackground);
  return data ? { ok: true } : { ok: false, error: "linkInvalid" };
}

const changesSchema = z.object({ ...quoteRef, note: z.string().trim().min(1, "required").max(2000) }).strict();

/** The client asks for changes (a note); a new version of the quote clears it. */
export async function requestQuoteChangesPortal(input: unknown): Promise<ActionResult> {
  const parsed = changesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ip = await clientIp();
  if ((await rateLimit(`portal:quote:${ip}`, 10, 600)) !== "ok") return { ok: false, error: "rateLimited" };
  const ua = (await headers()).get("user-agent") ?? "";
  const v = parsed.data;
  const { data, error } = await createAdminClient().rpc("portal_request_quote_changes", { p_number: v.number, p_token: v.token, p_note: v.note, p_ip: ip, p_user_agent: ua });
  if (error) return quoteRefused(error, "changes");
  if (data) after(runBackground);
  return data ? { ok: true } : { ok: false, error: "linkInvalid" };
}

const rejectSchema = z.object({ ...quoteRef, reason: z.string().trim().max(2000).nullable() }).strict();

/** The client declines the quote (optional reason). Final. */
export async function rejectQuotePortal(input: unknown): Promise<ActionResult> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ip = await clientIp();
  if ((await rateLimit(`portal:quote:${ip}`, 10, 600)) !== "ok") return { ok: false, error: "rateLimited" };
  const ua = (await headers()).get("user-agent") ?? "";
  const v = parsed.data;
  const { data, error } = await createAdminClient().rpc("portal_reject_quote", { p_number: v.number, p_token: v.token, p_reason: v.reason || null, p_ip: ip, p_user_agent: ua });
  if (error) return quoteRefused(error, "reject");
  if (data) after(runBackground);
  return data ? { ok: true } : { ok: false, error: "linkInvalid" };
}
