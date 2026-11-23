/**
 * "Send by WhatsApp" from the owner's own WhatsApp (Business) app: a wa.me link
 * with the message ready — the owner taps Send. No Meta setup, the client sees
 * the message in the same chat as always.
 */
export function waPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/[٠-٩]/g, (x) => String("٠١٢٣٤٥٦٧٨٩".indexOf(x))).replace(/\D/g, "");
  if (/^05\d{8}$/.test(d)) return `966${d.slice(1)}`;
  if (/^5\d{8}$/.test(d)) return `966${d}`;
  return /^\d{8,15}$/.test(d) ? d : null;
}

export function waHref(phone: string | null | undefined, text: string): string | null {
  const p = waPhone(phone);
  return p ? `https://wa.me/${p}?text=${encodeURIComponent(text.slice(0, 1500))}` : null;
}
