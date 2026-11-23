import "server-only";

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
