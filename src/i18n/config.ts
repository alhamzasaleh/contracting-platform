export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ar";
export const LOCALE_COOKIE = "NEXT_LOCALE";
export const NUMERALS_COOKIE = "numerals";
export type Numerals = "latn" | "arab";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}
export function dirOf(locale: Locale) {
  return locale === "ar" ? "rtl" : "ltr";
}
/** BCP-47 tag with numbering system, e.g. ar-SA-u-nu-latn. */
export function intlLocale(locale: Locale, numerals: Numerals) {
  return `${locale === "ar" ? "ar-SA" : "en-SA"}-u-nu-${numerals}-ca-gregory`;
}
