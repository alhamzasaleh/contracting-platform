import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from "./config";

/**
 * Locale comes from the user's cookie (kept in sync with their profile).
 * Numbers, money and dates are formatted with src/lib/format.ts so they
 * follow the user's numerals choice (٠١٢ or 012).
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return {
    locale,
    messages,
    timeZone: "Asia/Riyadh",
    onError: (e) => {
      if (process.env.NODE_ENV !== "production") console.warn(e.message);
    },
  };
});
