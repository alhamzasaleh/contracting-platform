import { describe, expect, it } from "vitest";
import { assistantLinks } from "@/lib/assistant/context";
import { deliveryDate } from "@/lib/contracts";
import { companyPaidRepairs, projectHref } from "@/lib/finance";
import { markBought, pickStockItem, projectBought, stillToAdd, type ListLine } from "@/lib/purchases";
import { findJournalEntry, pettyPlan } from "@/lib/qoyod/payloads";
import { projectDates } from "@/lib/schedule";

/** Review of batch 2, second round (Nov 2026). */

const line = (o: Partial<ListLine>): ListLine => ({ description: "x", colour: "", quantity: 4, unit: "pack", unit_price: 10, item: "new", product_id: null, general: true, ...o });

describe("#1 already bought: pack sizes and colours never mix", () => {
  it("18 L / 4 L: what the 18 L item has beyond its own line never fills the 4 L line", () => {
    const lines = [line({ description: "دهان (18)", item: "i18", product_id: "p1", quantity: 3 }), line({ description: "دهان (4)", product_id: "p1", quantity: 2 })];
    const bought = [{ item_id: "i18", product_id: "p1", colour: null, unit: "pack", quantity: 4 }];
    expect(markBought(lines, bought).map((l) => [l.description, l.bought, l.remaining])).toEqual([
      ["دهان (18)", 3, 0],
      ["دهان (4)", 0, 2],
    ]);
  });
  it("two new pack sizes of one product: a bought line can't tell which size it is → counted for neither", () => {
    const lines = [line({ description: "دهان (18)", product_id: "p1", quantity: 3 }), line({ description: "دهان (4)", product_id: "p1", quantity: 2 })];
    const bought = [{ item_id: "i9", product_id: "p1", colour: null, unit: "pack", quantity: 4 }];
    expect(markBought(lines, bought).map((l) => l.bought)).toEqual([0, 0]);
  });
  it("one size of a product: the product + unit fallback still works when the line has no stock item", () => {
    const lines = [line({ description: "معجون", product_id: "p2", quantity: 10 })];
    expect(markBought(lines, [{ item_id: "i5", product_id: "p2", colour: null, unit: "pack", quantity: 4 }])[0].remaining).toBe(6);
    // …but not from a stock item that is another suggested line's own item
    const two = [line({ description: "معجون", product_id: "p2", quantity: 10 }), line({ description: "معجون قديم", item: "i5", unit: "bag", quantity: 1 })];
    expect(markBought(two, [{ item_id: "i5", product_id: "p2", colour: null, unit: "pack", quantity: 4 }])[0].bought).toBe(0);
  });
  it("white / beige: the same item bought in beige never counts for white", () => {
    const lines = [line({ description: "دهان (18)", item: "i3", colour: "أبيض", product_id: "p1", quantity: 3, general: false }), line({ description: "دهان (18)", item: "i3", colour: "بيج", product_id: "p1", quantity: 2, general: false })];
    const bought = [{ item_id: "i3", product_id: "p1", colour: "بيج", unit: "pack", quantity: 4 }];
    expect(markBought(lines, bought).map((l) => [l.colour, l.bought, l.remaining])).toEqual([
      ["أبيض", 0, 3],
      ["بيج", 2, 0],
    ]);
    // null colour = no colour (general material)
    expect(markBought([line({ item: "i1", quantity: 5 })], [{ item_id: "i1", product_id: null, colour: null, unit: "pack", quantity: 2 }])[0].bought).toBe(2);
  });

  it("net stock on the project: purchases, issues and transfers in, minus returns; plus waiting purchases", () => {
    const items = [{ id: "i1", unit: "board", product_id: "p1" }, { id: "i3", unit: "pail", product_id: "p2" }];
    const rows = projectBought(
      [
        { item_id: "i1", quantity: 50, colour: "" }, // recorded purchase
        { item_id: "i1", quantity: 30, colour: null }, // issued from general stock
        { item_id: "i1", quantity: -10, colour: null }, // returned to stock
        { item_id: "i3", quantity: 4, colour: "بيج" }, // colour bought for the client
        { item_id: "i3", quantity: -1, colour: null }, // moved to another project
      ],
      [{ item_id: "i1", colour: null, unit: "board", quantity: 5 }],
      items,
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { item_id: "i1", product_id: "p1", colour: "", unit: "board", quantity: 70 },
        { item_id: "i3", product_id: "p2", colour: "بيج", unit: "pail", quantity: 3 },
        { item_id: "i1", product_id: "p1", colour: "", unit: "board", quantity: 5 },
      ]),
    );
    const lines = [line({ description: "لوح", item: "i1", unit: "board", quantity: 100 }), line({ description: "دهان", item: "i3", unit: "pail", colour: "بيج", quantity: 4 })];
    expect(markBought(lines, rows).map((l) => l.remaining)).toEqual([25, 1]);
    // everything returned → nothing counted (never negative)
    expect(projectBought([{ item_id: "i1", quantity: 30, colour: null }, { item_id: "i1", quantity: -30, colour: null }], [], items)).toEqual([]);
  });
});

describe("#2 «من قائمة مشتريات العرض» twice never doubles", () => {
  const list = [
    { ...line({ description: "لوح (2.88)", product_id: "pr1", quantity: 150 }), bought: 60, remaining: 90 },
    { ...line({ description: "دهان (18)", product_id: "pr2", colour: "بيج", quantity: 4, general: false }), bought: 0, remaining: 4 },
    { ...line({ description: "دهان (4)", product_id: "pr2", colour: "بيج", quantity: 1, general: false }), bought: 0, remaining: 1 },
  ];
  const row = (l: (typeof list)[number], o: Record<string, unknown> = {}) => ({ kind: "material" as const, item: l.item, newName: l.description, description: l.description, product: l.product_id ?? "", colour: l.colour, unit: l.unit, quantity: String(l.remaining), ...o });
  it("subtracts what the form rows already hold for the same item / product / colour", () => {
    expect(stillToAdd(list, []).map((l) => l.remaining)).toEqual([90, 4, 1]);
    // all added once (the boards row's description edited by hand) → nothing left to add
    expect(stillToAdd(list, [row(list[0], { description: "مقروء من الفاتورة" }), row(list[1]), row(list[2])])).toEqual([]);
    // a row removed → only that one comes back; a row with less → the difference
    expect(stillToAdd(list, [row(list[0], { quantity: "40" }), row(list[1])]).map((l) => [l.description, l.remaining])).toEqual([
      ["لوح (2.88)", 50],
      ["دهان (4)", 1],
    ]);
    // another colour or an expense row doesn't count
    expect(stillToAdd(list, [row(list[1], { colour: "أبيض" }), row(list[0], { kind: "expense" })]).map((l) => l.remaining)).toEqual([90, 4, 1]);
  });
});

describe("#3 changing a row's stock item drops the suggested product", () => {
  const items = [{ id: "i1", unit: "board" }, { id: "i2", unit: "box" }];
  const r = { kind: "material" as const, item: "new", unit: "pack", product: "pr1", suggested: { item: "new", product: "pr1" } };
  it("another item → no product (never a hidden product_id for another item); back to the suggested one → restored", () => {
    expect(pickStockItem(r, "i2", items)).toEqual({ kind: "material", item: "i2", unit: "box", product: "" });
    expect(pickStockItem({ ...r, item: "i2", product: "" }, "new", items)).toEqual({ kind: "material", item: "new", product: "pr1" });
    expect(pickStockItem(r, "__expense", items)).toEqual({ kind: "expense", item: "", product: "" });
    // a row typed by hand (no suggestion) loses its product when it moves to an item
    expect(pickStockItem({ kind: "material" as const, item: "new", unit: "pcs", product: "pr2" }, "i1", items)).toEqual({ kind: "material", item: "i1", unit: "board", product: "" });
  });
});

describe("#5 Qoyod petty cash without a cash account; journal lookups never guess", () => {
  it("no cash account (or the same as the bank) → the transfer is a no-op", () => {
    expect(pettyPlan(null, { receive_account_id: 10, cash_account_id: null })).toEqual({ post: "bank" });
    expect(pettyPlan(null, { receive_account_id: 10, cash_account_id: 10 })).toEqual({ post: "bank" });
    expect(pettyPlan(null, { receive_account_id: 10, cash_account_id: 20 })).toEqual({ post: "cash", cashAccountId: 20 });
  });
  it("finds an earlier entry by its tag; a failed lookup throws instead of posting a possible duplicate", async () => {
    const paths: string[] = [];
    const ok = async (p: string) => {
      paths.push(p);
      return { journal_entries: [{ id: 7, description: "other" }, { id: 9, description: "[PAYROLL-2026-11] — رواتب" }] };
    };
    expect(await findJournalEntry(ok, "[PAYROLL-2026-11]")).toBe(9);
    expect(paths[0]).toBe(`/journal_entries?q[description_cont]=${encodeURIComponent("[PAYROLL-2026-11]")}`);
    expect(await findJournalEntry(async () => ({ journal_entries: [] }), "[PETTY-x]")).toBeNull();
    await expect(findJournalEntry(async () => Promise.reject(new Error("network")), "[PETTY-x]")).rejects.toThrow("network");
  });
});

describe("#6 maintenance cost = what the company pays (covered by the warranty)", () => {
  it("drops repairs charged to the client and free ones", () => {
    const rows = [{ covered: true, cost: 300 }, { covered: false, cost: 500 }, { covered: true, cost: 0 }];
    expect(companyPaidRepairs(rows)).toEqual([{ covered: true, cost: 300 }]);
  });
});

describe("#7 project links follow the page's permission", () => {
  it("contract with quotes.view, else project with projects.view, else no link", () => {
    expect(projectHref("C-2026-001", { contracts: true, projects: true })).toBe("/contracts/C-2026-001");
    expect(projectHref("C-2026-001", { contracts: false, projects: true })).toBe("/projects/C-2026-001");
    expect(projectHref("C-2026-001", { contracts: false, projects: false })).toBeNull();
  });
  it("the assistant links to /purchases/costs only with costs.view AND purchases.view", () => {
    const links = [{ label: "c", href: "/purchases/costs" }];
    expect(assistantLinks(links, ["costs.view"], {})).toEqual([]);
    expect(assistantLinks(links, ["purchases.view"], {})).toEqual([]);
    expect(assistantLinks(links, ["costs.view", "purchases.view"], {})).toEqual(links);
    expect(assistantLinks([{ label: "p", href: "/purchases" }], ["purchases.view"], {})).toHaveLength(1);
  });
});

describe("#8 schedule: the bar ends on the last work day, delivery is the next day", () => {
  it("last work day = start + days − 1; delivery = deliveryDate()", () => {
    expect(projectDates("2026-12-01", 10)).toEqual({ lastWorkDay: "2026-12-10", delivery: "2026-12-11" });
    expect(projectDates("2026-12-01", 10).delivery).toBe(deliveryDate("2026-12-01", 10, 0));
  });
});
