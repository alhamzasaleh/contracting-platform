/**
 * Amounts in words for receipts (تفقيط): "ثمانية عشر ألف وأربعمائة ريال سعودي لا غير".
 * Covers 0 … 999,999,999.99 (riyals + halalas), in Arabic and English.
 */
const AR_ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const AR_TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const AR_HUNDREDS = ["", "مائة", "مئتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

function arBelow1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(AR_HUNDREDS[h]);
  if (r) {
    if (r < 20) parts.push(AR_ONES[r]);
    else parts.push(r % 10 ? `${AR_ONES[r % 10]} و${AR_TENS[Math.floor(r / 10)]}` : AR_TENS[Math.floor(r / 10)]);
  }
  return parts.join(" و");
}

function arGroup(n: number, one: string, two: string, few: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${arBelow1000(n)} ${few}`;
  return `${arBelow1000(n)} ${one}`;
}

export function arabicNumberWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "صفر";
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions) parts.push(arGroup(millions, "مليون", "مليونان", "ملايين"));
  if (thousands) parts.push(arGroup(thousands, "ألف", "ألفان", "آلاف"));
  if (rest) parts.push(arBelow1000(rest));
  return parts.join(" و");
}

const EN_ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function enBelow1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const out: string[] = [];
  if (h) out.push(`${EN_ONES[h]} hundred`);
  if (r) out.push(r < 20 ? EN_ONES[r] : EN_TENS[Math.floor(r / 10)] + (r % 10 ? `-${EN_ONES[r % 10]}` : ""));
  return out.join(" and ");
}

export function englishNumberWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "zero";
  const out: string[] = [];
  const m = Math.floor(n / 1_000_000);
  const t = Math.floor((n % 1_000_000) / 1000);
  const r = n % 1000;
  if (m) out.push(`${enBelow1000(m)} million`);
  if (t) out.push(`${enBelow1000(t)} thousand`);
  if (r) out.push(enBelow1000(r));
  return out.join(" ");
}

/** "فقط … ريال سعودي [و … هللة] لا غير" / "Saudi riyals … only". */
export function amountInWords(amount: number, locale: "ar" | "en"): string {
  const cents = Math.round(Math.abs(amount) * 100);
  const riyals = Math.floor(cents / 100);
  const halalas = cents % 100;
  if (locale === "ar") {
    const h = halalas ? ` و${arabicNumberWords(halalas)} هللة` : "";
    return `فقط ${arabicNumberWords(riyals)} ريال سعودي${h} لا غير`;
  }
  const h = halalas ? ` and ${englishNumberWords(halalas)} halalas` : "";
  return `${englishNumberWords(riyals)} Saudi riyals${h} only`.replace(/^./, (c) => c.toUpperCase());
}
