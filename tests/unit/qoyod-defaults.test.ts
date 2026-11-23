import { describe, expect, it } from "vitest";
import { pickDefaults, SERVICE_PRODUCTS } from "@/lib/qoyod/defaults";

describe("qoyod automatic setup", () => {
  it("picks the bank, sales and purchases accounts from a standard chart", () => {
    const d = pickDefaults({
      inventories: [{ id: 3, name: "المستودع الرئيسي" }],
      accounts: [
        { id: 7, code: "110101", name: "النقدية في الخزينة", receive: true, type: "Asset" },
        { id: 8, code: "110102", name: "البنك", receive: true, type: "Asset" },
        { id: 17, code: "410101", name: "المبيعات", receive: false, type: "Revenue" },
        { id: 50, code: "510101", name: "مصاريف إيجار", receive: false, type: "Expense" },
        { id: 52, code: "510102", name: "تكلفة المشتريات", receive: false, type: "Expense" },
        { id: 53, code: "510103", name: "رواتب وأجور", receive: false, type: "Expense" },
      ],
      products: [],
    });
    expect(d).toEqual({ inventoryId: 3, receiveAccountId: 8, salesAccountId: 17, expenseAccountId: 52, salaryAccountId: 53, cashAccountId: 7 });
  });

  it("falls back to the first suitable account, and to nothing when none exists", () => {
    const d = pickDefaults({ inventories: [], accounts: [{ id: 7, code: "110101", name: "الصندوق", receive: true, type: "Asset" }], products: [] });
    expect(d).toEqual({ inventoryId: null, receiveAccountId: 7, salesAccountId: null, expenseAccountId: null, salaryAccountId: null, cashAccountId: 7 });
  });

  it("every service has its own stable SKU", () => {
    expect(new Set(SERVICE_PRODUCTS.map((p) => p.sku)).size).toBe(SERVICE_PRODUCTS.length);
    expect(SERVICE_PRODUCTS.map((p) => p.service)).toEqual(["gypsum", "interior", "exterior", "addendum"]);
  });
});
