import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyWebhook } from "@/lib/auth/webhook";
import { sendSms, sendWhatsAppOtp } from "@/lib/notifications/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Supabase Auth "Send SMS" hook (§3.17): the sign-in code goes by WhatsApp
 * (authentication template), with SMS as the fallback. Supabase signs every call;
 * anything unsigned, stale or malformed is refused. The code is never logged.
 */
const payload = z.object({
  user: z.object({ phone: z.string().regex(/^\+?\d{8,15}$/) }).passthrough(),
  sms: z.object({ otp: z.string().regex(/^\d{4,10}$/) }).passthrough(),
});

const fail = (status: number, message: string) => NextResponse.json({ error: { http_code: status, message } }, { status });

async function hookSecret(): Promise<string | null> {
  if (process.env.SEND_SMS_HOOK_SECRET) return process.env.SEND_SMS_HOOK_SECRET;
  try {
    const { data } = await createAdminClient().rpc("auth_hook_secret", { p_name: "send_sms" });
    return (data as string | null) ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const body = await req.text();
  if (body.length > 20_000) return fail(413, "too large");
  const secret = await hookSecret();
  if (!secret) return fail(500, "hook not configured");
  const ok = verifyWebhook(secret, { id: req.headers.get("webhook-id"), timestamp: req.headers.get("webhook-timestamp"), signature: req.headers.get("webhook-signature") }, body);
  if (!ok) return fail(401, "invalid signature");
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return fail(400, "invalid payload");
  }
  const parsed = payload.safeParse(json);
  if (!parsed.success) return fail(400, "invalid payload");
  const phone = parsed.data.user.phone.replace(/^\+/, "");
  const code = parsed.data.sms.otp;

  const wa = await sendWhatsAppOtp(phone, code);
  if (wa.ok) return NextResponse.json({});
  const sms = await sendSms(phone, `رمز الدخول: ${code}\nلا تشاركه مع أحد.`);
  if (sms.ok) return NextResponse.json({});
  console.error("[auth] code not delivered", { whatsapp: wa.error, sms: sms.error });
  return fail(503, "could not deliver the code");
}
