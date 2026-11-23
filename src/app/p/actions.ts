"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import type { ActionResult } from "@/lib/actions";
import { NUMBER_RE, TOKEN_RE } from "@/lib/portal";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const acceptSchema = z
  .object({
    number: z.string().regex(NUMBER_RE),
    token: z.string().regex(TOKEN_RE),
    name: z.string().trim().min(2, "required").max(160),
    agree: z.literal(true),
    // optional drawn signature as a PNG data URL (size-limited)
    signature: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(200_000).nullable(),
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
    p_number: v.number, p_token: v.token, p_name: v.name, p_signature: v.signature, p_ip: ip, p_user_agent: ua,
  });
  if (error) {
    console.error("[portal] accept failed", { code: error.code });
    return { ok: false, error: "error" };
  }
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
  return { ok: true };
}
