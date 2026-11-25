import "server-only";
import { qoyod, qoyodOptions } from "./client";
import { pickDefaults, SERVICE_PRODUCTS } from "./defaults";

export type AutoSetupResult = {
  inventory_id: number | null;
  receive_account_id: number | null;
  expense_account_id: number | null;
  salary_account_id: number | null;
  cash_account_id: number | null;
  subcontract_account_id: number | null;
  commission_account_id: number | null;
  service_products: Record<string, number>;
  addendum_product_id: number | null;
};

/**
 * Everything Qoyod needs, prepared from our side: picks the warehouse and accounts,
 * and creates our service products (one per work type) if they don't exist yet —
 * the owner never has to enter anything in Qoyod. Idempotent (products found by SKU).
 */
export async function qoyodAutoSetup(key: string, vatRegistered: boolean): Promise<AutoSetupResult> {
  const options = await qoyodOptions(key);
  const d = pickDefaults(options);
  const result: AutoSetupResult = { inventory_id: d.inventoryId, receive_account_id: d.receiveAccountId, expense_account_id: d.expenseAccountId, salary_account_id: d.salaryAccountId, cash_account_id: d.cashAccountId, subcontract_account_id: d.subcontractAccountId, commission_account_id: d.commissionAccountId, service_products: {}, addendum_product_id: null };
  if (!d.salesAccountId) return result;

  const [{ categories = [] }, { product_unit_types: units = [] }] = await Promise.all([
    qoyod<{ categories?: { id: number; name: string; description?: string }[] }>(key, "GET", "/categories"),
    qoyod<{ product_unit_types?: { id: number; unit_name: string }[] }>(key, "GET", "/product_unit_types"),
  ]);
  let categoryId = categories.find((c) => /^services?$/i.test(c.name) || c.description === "خدمات")?.id;
  if (!categoryId) {
    const r = await qoyod<{ category?: { id: number } }>(key, "POST", "/categories", { category: { name: "Services", description: "خدمات" } });
    categoryId = r.category?.id;
  }
  const unitId = units.find((u) => /خدمة|وحدة|service|unit/i.test(u.unit_name))?.id ?? units[0]?.id;
  if (!categoryId || !unitId) return result;

  for (const p of SERVICE_PRODUCTS) {
    const found = await qoyod<{ products?: { id: number; sku?: string }[] }>(key, "GET", `/products?q[sku_eq]=${encodeURIComponent(p.sku)}`);
    let id = found.products?.find((x) => x.sku === p.sku)?.id;
    if (!id) {
      const r = await qoyod<{ product?: { id: number } }>(key, "POST", "/products", {
        product: {
          sku: p.sku, name_ar: p.ar, name_en: p.en, product_unit_type_id: String(unitId), category_id: String(categoryId),
          sale_item: "1", selling_price: "1", sales_account_id: String(d.salesAccountId), tax_id: vatRegistered ? "1" : "2",
        },
      });
      id = r.product?.id;
    }
    if (!id) continue;
    if (p.service === "addendum") result.addendum_product_id = id;
    else result.service_products[p.service] = id;
  }
  return result;
}
