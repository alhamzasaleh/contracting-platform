import { z } from "zod";

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v), schema.nullable());

const toAscii = (v: unknown) =>
  typeof v === "string" ? v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\s+/g, "") : v;

/** Company profile. Error messages are i18n keys under "settings". */
export const companySchema = z
  .object({
    name: z.string().trim().min(2, "required").max(120),
    legal_name: optional(z.string().trim().max(200)),
    cr_number: optional(z.preprocess(toAscii, z.string().regex(/^\d{10}$/, "crInvalid"))),
    vat_number: optional(z.preprocess(toAscii, z.string().regex(/^3\d{13}3$/, "vatInvalid"))),
    phone: optional(z.preprocess((v) => (typeof v === "string" ? (toAscii(v) as string).replace(/\D/g, "") : v), z.string().regex(/^\d{8,15}$/, "phoneInvalid"))),
    email: optional(z.string().trim().max(254).pipe(z.email("emailInvalid"))),
    city: optional(z.string().trim().max(80)),
    address: optional(z.string().trim().max(300)),
    signatory_name: optional(z.string().trim().min(2).max(120)),
    signatory_title: optional(z.string().trim().min(2).max(80)),
  })
  .strict();

export type CompanyInput = z.input<typeof companySchema>;

export const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/).transform((v) => v.toUpperCase());

export const brandSchema = z
  .object({
    primary: hexColor,
    accent: hexColor.nullable(),
    source: z.enum(["logo", "manual", "default"]),
  })
  .strict();

export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;

/** Verifies the file really is the image type it claims (magic bytes). */
export function sniffImageType(bytes: Uint8Array): (typeof LOGO_TYPES)[number] | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  const head = new TextDecoder().decode(bytes.slice(0, 1024)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return null;
}

/** Rejects SVGs with scripts, event handlers, external references or entities. */
export function isSafeSvg(text: string): boolean {
  const t = text.toLowerCase();
  return !(
    t.includes("<script") ||
    /\son[a-z]+\s*=/.test(t) ||
    t.includes("javascript:") ||
    t.includes("<foreignobject") ||
    t.includes("<!entity") ||
    t.includes("<!doctype") ||
    /(?:href|src)\s*=\s*["']\s*(?:https?:|data:text|\/\/)/.test(t)
  );
}
