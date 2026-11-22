import "server-only";
import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { createFormatter } from "@/lib/format";
import { isLocale, NUMERALS_COOKIE, type Locale, type Numerals } from "./config";

export async function getLocaleSettings(): Promise<{ locale: Locale; numerals: Numerals }> {
  const [raw, store] = await Promise.all([getLocale(), cookies()]);
  const locale = isLocale(raw) ? raw : "ar";
  const numerals: Numerals = store.get(NUMERALS_COOKIE)?.value === "arab" ? "arab" : "latn";
  return { locale, numerals };
}

export async function getFormatter() {
  const { locale, numerals } = await getLocaleSettings();
  return createFormatter(locale, numerals);
}
