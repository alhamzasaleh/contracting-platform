import { describe, expect, it } from "vitest";
import { applyInvoiceToRows, draftRows, includedRows, isOutsideList, linkToReady, listRows, prefillRows, readyCandidates, rowsForStillToAdd, type PurchaseRow } from "@/lib/purchases";

/**
 * «تسجيل مشتريات للمشروع» (owner, Nov 2026): the project's bill of quantities comes in ready (what is
 * still to buy), each line ticked «ضمن هذه الفاتورة»; materials outside it can be added and are marked;
 * a read invoice fills the ready lines it surely matches (one candidate, same unit) — anything else is
 * added as its own line the user can link to a ready line. Nothing is ever counted twice.
 */
type R = PurchaseRow;
let k = 0;
const next = () => ++k;
const blank = (): R => ({ key: next(), kind: "material", item: "new", newName: "", newUnit: "pcs", general: true, description: "", colour: "", quantity: "1", unit: "pcs", unit_price: "" });
const LIST = [
  { description: "لوح جبس عادي 12.5 — Knauf", colour: "", quantity: 60, unit: "pack", unit_price: 22, item: "it-board", product_id: "p-board", general: true, bought: 0, remaining: 60 },
  { description: "قطاع C رئيسي", colour: "", quantity: 120, unit: "bar", unit_price: 11, item: "new", product_id: "p-c", general: true, bought: 20, remaining: 100 },
  { description: "دهان جدران — Jotun", colour: "بيج", quantity: 4, unit: "pack", unit_price: 180, item: "new", product_id: "p-paint", general: false, bought: 4, remaining: 0 },
];
const items = [{ id: "it-board", name: "لوح جبس عادي 12.5 — Knauf", unit: "pack" }];
const ticked = (rows: R[]) => includedRows(rows).map((r) => `${r.description}:${r.quantity}`);

describe("ready from the bill of quantities", () => {
  it("lists only what is still to buy, ticked, with the quoted price and the remaining quantity", () => {
    const rows = listRows(LIST, next);
    expect(rows.map((r) => [r.description, r.quantity, r.unit_price, r.include, r.planned])).toEqual([
      ["لوح جبس عادي 12.5 — Knauf", "60", "22", true, 60],
      ["قطاع C رئيسي", "100", "11", true, 100],
    ]);
    expect(rows[0].suggested).toEqual({ item: "it-board", product: "p-board" });
  });
  it("without a price (no costs.view) the price is left empty, never 0", () => {
    expect(listRows([{ ...LIST[0], unit_price: 0 }], next)[0].unit_price).toBe("");
  });
  it("fills an empty form; never replaces lines the user already typed or read", () => {
    expect(prefillRows([blank()], LIST, next)).toHaveLength(2);
    const typed = { ...blank(), description: "مسامير" };
    expect(prefillRows([typed], LIST, next)).toEqual([typed]);
  });
  it("only ticked lines are saved and totalled", () => {
    const rows = listRows(LIST, next);
    rows[1].include = false;
    expect(ticked(rows)).toEqual(["لوح جبس عادي 12.5 — Knauf:60"]);
  });
  it("marks a material that isn't in the project's bill of quantities", () => {
    const rows = listRows(LIST, next);
    expect(isOutsideList(rows[0], true)).toBe(false);
    expect(isOutsideList({ ...blank(), description: "سلك" }, true)).toBe(true);
    expect(isOutsideList({ ...blank(), description: "سلك" }, false)).toBe(false);
    expect(isOutsideList({ ...blank(), description: "" }, true)).toBe(false);
    expect(isOutsideList({ ...blank(), kind: "expense", item: "", description: "نقل" }, true)).toBe(false);
  });
});

describe("another project picked", () => {
  it("swaps the untouched ready lines and keeps the user's own lines", () => {
    const mine = { ...blank(), description: "مادة إضافية", unit_price: "5" };
    const other = [{ ...LIST[0], description: "معجون", item: "it-putty", product_id: null, remaining: 3 }];
    const after = prefillRows([...listRows(LIST, next), mine], other, next, { replaceList: true });
    expect(after.map((r) => r.description)).toEqual(["مادة إضافية", "معجون"]);
  });
  it("after reading an invoice (or typing lines) the new ready lines come unticked — never counted twice", () => {
    const read = applyInvoiceToRows([blank()], [{ description: "لوح جبس عادي 12.5 — Knauf", quantity: 10, unit: "pack", unit_price: 22 }], [], items, next);
    const after = prefillRows(read, LIST, next, { replaceList: true });
    expect(ticked(after)).toEqual(["لوح جبس عادي 12.5 — Knauf:10"]);
    expect(after.filter((r) => r.suggested).every((r) => r.include === false)).toBe(true);
  });
  it("a ready line the user edited is kept as his own line, not thrown away", () => {
    const rows = listRows(LIST, next);
    rows[0].quantity = "7";
    rows[0].unit_price = "20.5";
    const after = prefillRows(rows, [], next, { replaceList: true });
    expect(after.map((r) => [r.description, r.quantity, r.unit_price, r.suggested])).toEqual([["لوح جبس عادي 12.5 — Knauf", "7", "20.5", undefined]]);
  });
});

describe("a read invoice", () => {
  it("fills the ready line it surely matches; ready lines not on it are unticked; others are added apart", () => {
    const out = applyInvoiceToRows(listRows(LIST, next), [
      { description: "لوح جبس عادي 12.5 — Knauf", quantity: 40, unit: "pack", unit_price: 21.5 },
      { description: "مسامير جبس", quantity: 2, unit: "box", unit_price: 35 },
    ], [], items, next);
    const board = out.find((r) => r.suggested?.item === "it-board")!;
    expect([board.quantity, board.unit_price, board.include]).toEqual(["40", "21.5", true]);
    expect(out.find((r) => r.description === "قطاع C رئيسي")!.include).toBe(false);
    const extra = out.find((r) => r.description === "مسامير جبس")!;
    expect([extra.include, extra.suggested, extra.fromInvoice]).toEqual([true, undefined, true]);
  });
  it("matches by name loosely (spaces, hamza, ta marbuta, case)", () => {
    const out = applyInvoiceToRows(listRows(LIST, next), [{ description: "قطاع  c رئيسى", quantity: 50, unit: "bar", unit_price: 10 }], [], items, next);
    expect(out.find((r) => r.description === "قطاع C رئيسي")!.quantity).toBe("50");
    expect(out).toHaveLength(2);
  });
  it("reading again replaces the previous reading — no line twice", () => {
    const once = applyInvoiceToRows(listRows(LIST, next), [{ description: "مسامير", quantity: 2, unit: "box", unit_price: 35 }], [], items, next);
    const twice = applyInvoiceToRows(once, [{ description: "مسامير", quantity: 2, unit: "box", unit_price: 35 }], [], items, next);
    expect(twice.filter((r) => r.description === "مسامير")).toHaveLength(1);
  });
  it("another unit is never matched (2000 pcs ≠ 2 packs): added apart and flagged", () => {
    const out = applyInvoiceToRows(listRows(LIST, next), [{ description: "لوح جبس عادي 12.5 — Knauf", quantity: 600, unit: "pcs", unit_price: 2.2 }], [], items, next);
    expect(out.find((r) => r.suggested?.item === "it-board")!.include).toBe(false);
    const extra = out.find((r) => r.fromInvoice)!;
    expect([extra.unit, extra.unclear]).toEqual(["pcs", true]);
  });
  it("two candidates (sizes, colours, a bare brand) → no guess: added apart and flagged", () => {
    const two = [
      { ...LIST[0], description: "دهان جدران — Jotun (18)", item: "it-paint", colour: "أبيض", remaining: 3 },
      { ...LIST[0], description: "دهان جدران — Jotun (18)", item: "it-paint", colour: "بيج", remaining: 2 },
    ];
    const out = applyInvoiceToRows(listRows(two, next), [{ description: "دهان جدران — Jotun (18)", quantity: 2, unit: "pack", unit_price: 180 }], [], [{ id: "it-paint", name: "دهان جدران — Jotun (18)", unit: "pack" }], next);
    expect(out.filter((r) => r.suggested).every((r) => r.include === false)).toBe(true);
    expect(out.find((r) => r.fromInvoice)!.unclear).toBe(true);
    // the user links it to the right colour himself
    const extra = out.find((r) => r.fromInvoice)!;
    const beige = out.find((r) => r.colour === "بيج")!;
    expect(readyCandidates(out).map((r) => r.colour)).toEqual(["أبيض", "بيج"]);
    const linked = linkToReady(out, extra.key, beige.key);
    expect(ticked(linked)).toEqual(["دهان جدران — Jotun (18):2"]);
    expect(linked.find((r) => r.colour === "بيج")!.include).toBe(true);
    expect(linked.some((r) => r.key === extra.key)).toBe(false);
  });
  it("without ready lines the invoice lines replace the blank form, as before", () => {
    const out = applyInvoiceToRows([blank()], [{ description: "مسامير", quantity: 2, unit: "box", unit_price: 35 }], [], items, next);
    expect(out.map((r) => r.description)).toEqual(["مسامير"]);
  });
  it("flags unclear invoice lines on the line they landed on", () => {
    const out = applyInvoiceToRows(listRows(LIST, next), [{ description: "قطاع C رئيسي", quantity: 50, unit: "bar", unit_price: 10 }], ["lines[0].quantity"], items, next);
    expect(out.find((r) => r.description === "قطاع C رئيسي")!.unclear).toBe(true);
  });
});

describe("re-adding from the list and editing a draft", () => {
  it("«من قائمة مشتريات العرض» counts a ready line at its planned quantity — it only brings back removed lines", () => {
    const rows = listRows(LIST, next);
    rows[0].quantity = "10"; // bought 10 now, 50 stay for next time
    expect(rowsForStillToAdd(rows).find((r) => r.description.startsWith("لوح"))!.quantity).toBe("60");
  });
  it("a saved draft's lines that are in the bill of quantities are recognised (not «outside»)", () => {
    const rows = draftRows(
      [
        { kind: "material", item_id: "it-board", description: "لوح جبس", colour: null, quantity: 10, unit: "pack", unit_price: 22 },
        { kind: "material", item_id: "it-wire", description: "سلك", colour: null, quantity: 1, unit: "roll", unit_price: 15 },
      ],
      LIST,
      next,
    );
    expect(rows.map((r) => [r.description, !!r.suggested, r.include])).toEqual([
      ["لوح جبس", true, true],
      ["سلك", false, undefined],
    ]);
  });
});
