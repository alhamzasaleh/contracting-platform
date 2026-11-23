"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { LOCALE_COOKIE, NUMERALS_COOKIE } from "@/i18n/config";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { otpSchema, safeNext, saudiMobileSchema } from "@/lib/validation/phone";

type Result = { ok: true; next?: string } | { ok: false; error: "phoneInvalid" | "codeInvalid" | "notAllowed" | "rateLimited" | "error" };

const requestSchema = z.object({ phone: saudiMobileSchema }).strict();
const verifySchema = z.object({ phone: saudiMobileSchema, code: otpSchema, next: z.string().max(500).optional() }).strict();

export async function requestOtp(input: z.input<typeof requestSchema>): Promise<Result> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "phoneInvalid" };
  const { phone } = parsed.data;

  const ip = await clientIp();
  const [byPhone, byIp] = await Promise.all([
    rateLimit(`otp:phone:${phone}`, 4, 600),
    rateLimit(`otp:ip:${ip}`, 15, 600),
  ]);
  if (byPhone === "unavailable" || byIp === "unavailable") return { ok: false, error: "error" };
  if (byPhone === "limited" || byIp === "limited") return { ok: false, error: "rateLimited" };

  const { data: allowed, error: allowErr } = await createAdminClient().rpc("auth_phone_allowed", { p_phone: phone });
  if (allowErr) {
    console.error("[login] allow-list check failed", { code: allowErr.code, message: allowErr.message });
    return { ok: false, error: "error" };
  }
  if (!allowed) return { ok: false, error: "notAllowed" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone: `+${phone}`, options: { channel: "sms" } });
  if (error) {
    console.error("[login] send OTP failed", { status: error.status, code: error.code, message: error.message });
    return { ok: false, error: error.status === 429 ? "rateLimited" : "error" };
  }
  return { ok: true };
}

export async function verifyOtp(input: z.input<typeof verifySchema>): Promise<Result> {
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "codeInvalid" };
  const { phone, code, next } = parsed.data;

  const limit = await rateLimit(`verify:phone:${phone}`, 8, 600);
  if (limit === "unavailable") return { ok: false, error: "error" };
  if (limit === "limited") return { ok: false, error: "rateLimited" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ phone: `+${phone}`, token: code, type: "sms" });
  if (error || !data.user) {
    if (error) console.error("[login] verify OTP failed", { status: error.status, code: error.code });
    return { ok: false, error: "codeInvalid" };
  }

  await afterSignIn(supabase, data.user.id);
  return { ok: true, next: safeNext(next) };
}

/** After any sign-in: pending invitations become memberships; the user's language/numerals apply on this device. */
async function afterSignIn(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  await supabase.rpc("accept_pending_invitations");
  const { data: profile } = await supabase.from("profiles").select("locale, numerals").eq("id", userId).single();
  if (profile) {
    const store = await cookies();
    const opts = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };
    store.set(LOCALE_COOKIE, profile.locale, opts);
    store.set(NUMERALS_COOKIE, profile.numerals, opts);
  }
}

const finishSchema = z.object({ next: z.string().max(500).optional() }).strict();

/**
 * Passkey sign-in (Face ID / fingerprint): the browser completes the WebAuthn
 * ceremony with Supabase Auth, which sets the session; here the server checks
 * that session and finishes the same steps as an OTP sign-in.
 */
export async function finishPasskeySignIn(input: z.input<typeof finishSchema>): Promise<Result> {
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "error" };
  const limit = await rateLimit(`passkey:ip:${await clientIp()}`, 30, 600);
  if (limit !== "ok") return { ok: false, error: limit === "limited" ? "rateLimited" : "error" };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { ok: false, error: "error" };
  await afterSignIn(supabase, data.user.id);
  return { ok: true, next: safeNext(parsed.data.next) };
}
