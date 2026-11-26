import { describe, expect, it } from "vitest";
import { applyInvoiceToRows, includedRows, isOutsideList, listRows, prefillRows, type PurchaseRow } from "@/lib/purchases";

/**
 * «تسجيل مشتريات للمشروع» (owner, Nov 2026): the project's bill of quantities comes in ready (what is
 * still to buy), each line ticked «ضمن هذه الفاتورة»; materials outside it can be added and are marked;
 * a read invoice is matched to the ready lines instead of being added twice.
 */
type R = PurchaseRow;
let k = 0;
const blank = (): R => ({ key: ++k, kind: "material", item: "new", newName: "", newUnit: "pcs", general: true, description: "", colour: "", quantity: "1", unit: "pcs", unit_price: "" });
const LIST = [
  { description: "لوح جبس عادي 12.5 — Knauf", colour: "", quantity: 60, unit: "pack", unit_price: 22, item: "it-board", product_id: "p-board", general: true, bought: 0, remaining: 60 },
  { description: "قطاع C رئيسي", colour: "", quantity: 120, unit: "bar", unit_price: 11, item: "new", product_id: "p-c", general: true, bought: 20, remaining: 100 },
  { description: "دهان جدران — Jotun", colour: "بيج", quantity: 4, unit: "pack", unit_price: 180, item: "new", product_id: "p-paint", general: false, bought: 4, remaining: 0 },
];
const next = () => ++k;

describe("ready from the bill of quantities", () => {
  it("lists only what is still to buy, ticked, with the quoted price and the remaining quantity", () => {
    const rows = listRows(LIST, next);
    expect(rows.map((r) => [r.description, r.quantity, r.unit_price, r.include])).toEqual([
      ["لوح جبس عادي 12.5 — Knauf", "60", "22", true],
      ["قطاع C رئيسي", "100", "11", true],
    ]);
    expect(rows[0].suggested).toEqual({ item: "it-board", product: "p-board" });
  });
  it("fills an empty form; never replaces lines the user already typed or read", () => {
    expect(prefillRows([blank()], LIST, next)).toHaveLength(2);
    const typed = { ...blank(), description: "مسامير" };
    expect(prefillRows([typed], LIST, next)).toEqual([typed]);
  });
  it("switching project swaps the ready lines and keeps the user's own lines", () => {
    const mine = { ...blank(), description: "مادة إضافية", unit_price: "5" };
    const before = [...listRows(LIST, next), mine];
    const other = [{ ...LIST[0], description: "معجون", item: "it-putty", product_id: null, remaining: 3 }];
    const after = prefillRows(before, other, next, { replaceList: true });
    expect(after.map((r) => r.description)).toEqual(["مادة إضافية", "معجون"]);
  });
  it("only ticked lines are saved and totalled", () => {
    const rows = listRows(LIST, next);
    rows[1].include = false;
    expect(includedRows(rows).map((r) => r.description)).toEqual(["لوح جبس عادي 12.5 — Knauf"]);
  });
  it("marks a material that isn't in the project's bill of quantities", () => {
    const rows = listRows(LIST, next);
    expect(isOutsideList(rows[0], true)).toBe(false);
    expect(isOutsideList({ ...blank(), description: "سلك" }, true)).toBe(true);
    expect(isOutsideList({ ...blank(), description: "سلك" }, false)).toBe(false); // no list → nothing to compare with
    expect(isOutsideList({ ...blank(), description: "" }, true)).toBe(false); // empty line
    expect(isOutsideList({ ...blank(), kind: "expense", item: "", description: "نقل" }, true)).toBe(false); // expenses aren't materials
  });
});

describe("a read invoice is matched to the ready lines", () => {
  const items = [{ id: "it-board", name: "لوح جبس عادي 12.5 — Knauf", unit: "pack" }];
  it("updates the matching lines with the invoice's quantity and price, unticks the rest, adds the unknown ones", () => {
    const rows = listRows(LIST, next);
    const out = applyInvoiceToRows(rows, [
      { description: "لوح جبس عادي 12.5 — Knauf", quantity: 40, unit: "pack", unit_price: 21.5 },
      { description: "مسامير جبس", quantity: 2, unit: "box", unit_price: 35 },
    ], [], items, next);
    const board = out.find((r) => r.suggested?.item === "it-board")!;
    expect([board.quantity, board.unit_price, board.include]).toEqual(["40", "21.5", true]);
    expect(out.find((r) => r.description === "قطاع C رئيسي")!.include).toBe(false);
    const extra = out.find((r) => r.description === "مسامير جبس")!;
    expect([extra.include, extra.suggested, extra.quantity]).toEqual([true, undefined, "2"]);
  });
  it("matches by name loosely (spaces, hamza, ta marbuta)", () => {
    const rows = listRows(LIST, next);
    const out = applyInvoiceToRows(rows, [{ description: "قطاع  c رئيسى", quantity: 50, unit: "bar", unit_price: 10 }], [], items, next);
    const c = out.find((r) => r.description === "قطاع C رئيسي")!;
    expect([c.quantity, c.include]).toEqual(["50", true]);
    expect(out).toHaveLength(2);
  });
  it("without ready lines the invoice lines replace the blank form, as before", () => {
    const out = applyInvoiceToRows([blank()], [{ description: "مسامير", quantity: 2, unit: "box", unit_price: 35 }], [], items, next);
    expect(out.map((r) => r.description)).toEqual(["مسامير"]);
  });
  it("flags unclear invoice lines on the line they landed on", () => {
    const rows = listRows(LIST, next);
    const out = applyInvoiceToRows(rows, [{ description: "قطاع C رئيسي", quantity: 50, unit: "bar", unit_price: 10 }], ["lines[0].quantity"], items, next);
    expect(out.find((r) => r.description === "قطاع C رئيسي")!.unclear).toBe(true);
  });
});
