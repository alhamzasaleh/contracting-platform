import { z } from "zod";

export const idDigits = (v: unknown) =>
  typeof v === "string"
    ? v
        .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
        .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
        .replace(/\D/g, "")
    : v;

/**
 * A Saudi ID (starts with 1) or iqama (starts with 2) carries a check digit (Luhn). A commercial
 * registration (1010…, 2050…) doesn't, so a failed check is only a warning («تأكد من الرقم»),
 * never a refusal (warn, don't block). Other 10-digit numbers are kept as typed.
 */
export function idNumberValid(s: string): boolean {
  if (!/^\d{10}$/.test(s)) return false;
  if (s[0] !== "1" && s[0] !== "2") return true;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(s[i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** 10 digits: the ID / iqama / commercial registration the contract names the client by. */
export function idNumberComplete(v: unknown): boolean {
  return /^\d{10}$/.test(String(idDigits(v)));
}

/** The client types his ID number on his page (owner, Nov 2026) — required when his record has none. */
export const clientIdNumber = z.preprocess(idDigits, z.string().regex(/^\d{10}$/, "idInvalid"));
