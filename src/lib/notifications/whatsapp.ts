import "server-only";
import { whatsappOtpPayload } from "./whatsapp-payload";

/**
 * WhatsApp Business Cloud API sender (§3.18). Active only when the account is
 * connected: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TEMPLATE
 * (an approved template with one body parameter) in the server environment.
 */
export const whatsappConfigured = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TEMPLATE);

export async function sendWhatsApp(phone: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!whatsappConfigured()) return { ok: false, error: "not_configured" };
  const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID!)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: process.env.WHATSAPP_TEMPLATE,
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "ar" },
        components: [{ type: "body", parameters: [{ type: "text", text: text.slice(0, 900) }] }],
      },
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res) return { ok: false, error: "network" };
  if (!res.ok) return { ok: false, error: `http_${res.status}` };
  return { ok: true };
}

/** Sign-in codes go through a separate AUTHENTICATION template (copy-code button). */
export const whatsappOtpConfigured = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_OTP_TEMPLATE);

/**
 * §3.17: the sign-in code by WhatsApp. Meta's authentication templates take the code
 * twice — in the body and in the copy-code button.
 */
export async function sendWhatsAppOtp(phone: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!whatsappOtpConfigured()) return { ok: false, error: "not_configured" };
  const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID!)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(whatsappOtpPayload(phone, code, process.env.WHATSAPP_OTP_TEMPLATE!, process.env.WHATSAPP_OTP_LANG || "ar")),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) return { ok: false, error: "network" };
  if (!res.ok) return { ok: false, error: `http_${res.status}` };
  return { ok: true };
}

/** SMS fallback (Twilio-compatible), only when its keys are set. */
export const smsConfigured = () => Boolean(process.env.SMS_TWILIO_ACCOUNT_SID && process.env.SMS_TWILIO_AUTH_TOKEN && process.env.SMS_TWILIO_FROM);

export async function sendSms(phone: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!smsConfigured()) return { ok: false, error: "not_configured" };
  const sid = process.env.SMS_TWILIO_ACCOUNT_SID!;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${process.env.SMS_TWILIO_AUTH_TOKEN}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: `+${phone}`, From: process.env.SMS_TWILIO_FROM!, Body: text }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) return { ok: false, error: "network" };
  if (!res.ok) return { ok: false, error: `http_${res.status}` };
  return { ok: true };
}
