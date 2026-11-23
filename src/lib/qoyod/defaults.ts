import type { QoyodOptions } from "./client";

/** Our services as products in Qoyod (created automatically, found again by SKU). */
export const SERVICE_PRODUCTS = [
  { service: "gypsum", sku: "SRV-GYPSUM", ar: "أعمال الجبس", en: "Gypsum works" },
  { service: "interior", sku: "SRV-INTERIOR-PAINT", ar: "أعمال الدهانات الداخلية", en: "Interior painting works" },
  { service: "exterior", sku: "SRV-EXTERIOR-PAINT", ar: "أعمال دهانات الواجهات الخارجية", en: "Exterior painting works" },
  { service: "addendum", sku: "SRV-ADDITIONAL", ar: "أعمال إضافية", en: "Additional works" },
] as const;

type Account = QoyodOptions["accounts"][number];
const match = (a: Account, re: RegExp) => re.test(a.name);

/** Sensible choices from a Qoyod chart of accounts (the owner can still change them). */
export function pickDefaults(o: QoyodOptions) {
  const receive = o.accounts.filter((a) => a.receive);
  const revenue = o.accounts.filter((a) => /revenue|income/i.test(a.type) || a.code.startsWith("4"));
  const expense = o.accounts.filter((a) => /expense/i.test(a.type) || a.code.startsWith("5"));
  return {
    inventoryId: o.inventories[0]?.id ?? null,
    receiveAccountId: (receive.find((a) => match(a, /بنك|مصرف|bank/i)) ?? receive[0])?.id ?? null,
    salesAccountId: (revenue.find((a) => match(a, /مبيعات|إيرادات|ايرادات|sales|revenue/i)) ?? revenue[0])?.id ?? null,
    expenseAccountId: (expense.find((a) => match(a, /مشتريات|تكلفة|purchases|cost/i)) ?? expense[0])?.id ?? null,
  };
}
