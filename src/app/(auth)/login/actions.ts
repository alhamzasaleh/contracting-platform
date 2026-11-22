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
  if (!byPhone || !byIp) return { ok: false, error: "rateLimited" };

  const { data: allowed, error: allowErr } = await createAdminClient().rpc("auth_phone_allowed", { p_phone: phone });
  if (allowErr) return { ok: false, error: "error" };
  if (!allowed) return { ok: false, error: "notAllowed" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone: `+${phone}`, options: { channel: "sms" } });
  if (error) return { ok: false, error: error.status === 429 ? "rateLimited" : "error" };
  return { ok: true };
}

export async function verifyOtp(input: z.input<typeof verifySchema>): Promise<Result> {
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "codeInvalid" };
  const { phone, code, next } = parsed.data;

  if (!(await rateLimit(`verify:phone:${phone}`, 8, 600))) return { ok: false, error: "rateLimited" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ phone: `+${phone}`, token: code, type: "sms" });
  if (error || !data.user) return { ok: false, error: "codeInvalid" };

  // Pending invitations become memberships on first sign-in.
  await supabase.rpc("accept_pending_invitations");

  // Apply the user's saved language/numerals on this device.
  const { data: profile } = await supabase.from("profiles").select("locale, numerals").eq("id", data.user.id).single();
  if (profile) {
    const store = await cookies();
    const opts = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };
    store.set(LOCALE_COOKIE, profile.locale, opts);
    store.set(NUMERALS_COOKIE, profile.numerals, opts);
  }

  return { ok: true, next: safeNext(next) };
}
