import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { z } from "zod";

/**
 * Accepts Saudi mobiles in any common form (05XXXXXXXX, 5XXXXXXXX,
 * +9665XXXXXXXX, with spaces or Arabic digits) and returns E.164 digits
 * without '+', e.g. "966512345678".
 */
export function normalizeSaudiMobile(input: string): string | null {
  const ascii = input
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[^\d+]/g, "");
  const parsed = parsePhoneNumberFromString(ascii, "SA");
  if (!parsed || parsed.country !== "SA" || !parsed.isValid()) return null;
  const national = parsed.nationalNumber.toString();
  if (!/^5\d{8}$/.test(national)) return null; // mobiles only
  return `966${national}`;
}

export const saudiMobileSchema = z
  .string()
  .max(32)
  .transform((v, ctx) => {
    const n = normalizeSaudiMobile(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "phoneInvalid" });
      return z.NEVER;
    }
    return n;
  });

export const otpSchema = z.string().regex(/^\d{6}$/, "codeInvalid");

/** Only allow same-origin relative redirects (prevents open redirects). */
export function safeNext(next: unknown): string {
  if (typeof next !== "string") return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
