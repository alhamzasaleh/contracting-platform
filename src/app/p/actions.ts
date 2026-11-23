"use server";

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
