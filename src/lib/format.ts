import { intlLocale, type Locale, type Numerals } from "@/i18n/config";

/** Formatting helpers that honour the user's numerals choice (٠١٢ or 012). */
export function createFormatter(locale: Locale, numerals: Numerals) {
  const tag = intlLocale(locale, numerals);
  const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
  const nf = (key: string, opts: Intl.NumberFormatOptions) => {
    if (!cache.has(key)) cache.set(key, new Intl.NumberFormat(tag, opts));
    return cache.get(key) as Intl.NumberFormat;
  };
  const df = (key: string, opts: Intl.DateTimeFormatOptions) => {
    if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(tag, { timeZone: "Asia/Riyadh", ...opts }));
    return cache.get(key) as Intl.DateTimeFormat;
  };
  return {
    number: (n: number, digits = 0) =>
      nf(`n${digits}`, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n),
    money: (n: number) =>
      nf("sar", { style: "currency", currency: "SAR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n),
    compactMoney: (n: number) =>
      nf("csar", { style: "currency", currency: "SAR", notation: "compact", maximumFractionDigits: 1 }).format(n),
    percent: (ratio: number, digits = 1) =>
      nf(`p${digits}`, { style: "percent", maximumFractionDigits: digits }).format(ratio),
    date: (d: Date | string) => df("d", { day: "numeric", month: "short", year: "numeric" }).format(new Date(d)),
    dayMonth: (d: Date | string) => df("dm", { day: "numeric", month: "short" }).format(new Date(d)),
    monthYear: (d: Date | string) => df("my", { month: "long", year: "numeric" }).format(new Date(d)),
    weekday: (d: Date | string) => df("wd", { weekday: "short" }).format(new Date(d)),
    dateTime: (d: Date | string) =>
      df("dt", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(
        new Date(d),
      ),
    relative: (d: Date | string, now = new Date()) => {
      const diff = (new Date(d).getTime() - now.getTime()) / 1000;
      const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
      const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ["year", 31536000],
        ["month", 2592000],
        ["week", 604800],
        ["day", 86400],
        ["hour", 3600],
        ["minute", 60],
      ];
      for (const [unit, secs] of units) {
        if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
      }
      return rtf.format(Math.round(diff), "second");
    },
    /** Document numbers / phone numbers: digits only re-mapped, layout kept LTR. */
    digits: (s: string) =>
      numerals === "arab" ? s.replace(/[0-9]/g, (c) => "٠١٢٣٤٥٦٧٨٩"[Number(c)]) : s,
  };
}
export type Formatter = ReturnType<typeof createFormatter>;
