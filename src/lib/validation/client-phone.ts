import { z } from "zod";

const digits = (v: unknown) => (typeof v === "string" ? v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/\D/g, "") : v);

/**
 * The client's phone — required (owner, Nov 2026: WhatsApp, the client page and the contract use it).
 * Saudi mobile 05xxxxxxxx / 5xxxxxxxx / 9665xxxxxxxx → 9665xxxxxxxx; an international number is kept as typed.
 */
export const clientPhone = z.preprocess((v) => {
  const raw = digits(v);
  if (typeof raw !== "string" || raw === "") return "";
  let d = raw;
  if (d.startsWith("00")) d = d.slice(2); // 00971… = +971…
  if (d.startsWith("9660")) d = `966${d.slice(4)}`; // +966 05… typed with the local 0
  if (/^05\d{8}$/.test(d)) return `966${d.slice(1)}`;
  if (/^5\d{8}$/.test(d)) return `966${d}`;
  return d;
  // a number starting with 0 that isn't a Saudi mobile (a landline) can't receive WhatsApp
}, z.string().min(1, "required").regex(/^[1-9]\d{7,14}$/, "phoneInvalid"));

/** A stored number (client, subcontractor, team) as a form shows it: a Saudi one as 05…, any other with its + (kept as is on save). */
export function phoneForInput(p: string | null | undefined): string {
  if (!p) return "";
  return p.startsWith("966") ? `0${p.slice(3)}` : `+${p}`;
}
