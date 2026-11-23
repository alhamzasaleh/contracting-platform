import { describe, expect, it } from "vitest";
import { cleanDraft } from "@/lib/survey/ai-draft";

const room = (o: Partial<Parameters<typeof cleanDraft>[0]["rooms"][number]>) => ({
  name: "غرفة", unit_label: null, length_m: 4, width_m: 3, height_m: 3, openings_m2: null, gypsum_ceiling: false,
  ceiling_board: "normal" as const, wall_zone: "normal" as const, paint_walls: true, paint_ceiling: true, ...o,
});
const totals = { walls: null, ceilings: null, facade: null, partitions: null, troughM: null, shadowM: null, crackM: null, colours: null };

describe("AI survey draft cleaning", () => {
  it("keeps plausible numbers, fills the usual height and lists what's missing", () => {
    const d = cleanDraft(
      { rooms: [room({ name: " المجلس ", height_m: null }), room({ length_m: -2, width_m: 500 }), room({ name: "" })], totals: { ...totals, troughM: 12, walls: -5 }, unclear: ["x"] },
      3.2,
    );
    expect(d.rooms[0]).toMatchObject({ name: "المجلس", height_m: 3.2, missing: ["height"] });
    expect(d.rooms[1]).toMatchObject({ length_m: null, width_m: null, missing: ["length", "width"] });
    expect(d.rooms[2].name).toBe("غرفة 3");
    expect(d.totals).toEqual({ troughM: 12 });
  });
});

describe("suggestions from past quotes", async () => {
  const { pastStats } = await import("@/lib/pricing/history");
  it("suggests the median winning margin (never below the minimum) and typical prices", () => {
    const wt = (p: number) => [{ workType: "walls", pricePerM2: p }];
    const s = pastStats(
      [
        { outcome: "won", margin: 24, workTypes: wt(30), plannedDays: 10, actualDays: 12 },
        { outcome: "won", margin: 27.3, workTypes: wt(32), plannedDays: 10, actualDays: 11 },
        { outcome: "won", margin: 26, workTypes: wt(34) },
        { outcome: "lost", margin: 33, workTypes: wt(40) },
      ],
      20,
    );
    expect(s).toMatchObject({ won: 3, lost: 1, winRate: 75, wonMargin: 26, lostMargin: 33, suggestedMargin: 26, durationFactor: 1.15 });
    expect(s.pricePerM2).toEqual([{ workType: "walls", median: 32, count: 3 }]);
    expect(pastStats([{ outcome: "won", margin: 12, workTypes: [] }, { outcome: "won", margin: 14, workTypes: [] }, { outcome: "won", margin: 13, workTypes: [] }], 20).suggestedMargin).toBe(20);
    expect(pastStats([{ outcome: "won", margin: 30, workTypes: [] }], 20).suggestedMargin).toBeNull();
  });
});

describe("datasheet draft cleaning", async () => {
  const { cleanDatasheet } = await import("@/lib/catalogue/datasheet");
  it("drops impossible coverage, sorts packs and rounds coats", () => {
    const d = cleanDatasheet({ product_name: "x", brand: "Jotun", category: "finish_paint", unit: "L", coverage_m2_per_unit: 120, coverage_text: null, pack_sizes: [4, 18, 18, -1], recommended_coats: 2.2, drying_time: null, use: "interior", notes: [], unclear: [] });
    expect(d.coverage_m2_per_unit).toBeNull();
    expect(d.flags).toEqual(["coverage"]);
    expect(d.pack_sizes).toEqual([18, 4]);
    expect(d.recommended_coats).toBe(2);
  });
});

describe("calibration (A.8)", async () => {
  const { calibrate, suggestedCoverage } = await import("@/lib/calibration");
  it("flags a product used consistently more than planned, and only then", () => {
    const proj = (c: string, actual: number, primer?: number) => ({
      contract: c,
      planned: [{ productId: "paint", label: "دهان", qty: 10, unitPrice: 100 }, { productId: "primer", label: "أساس", qty: 2, unitPrice: 120 }],
      actual: { paint: actual, ...(primer != null ? { primer } : {}) },
    });
    const rows = calibrate([proj("C-1", 1150, 240), proj("C-2", 1120, 250), proj("C-3", 1200, 200)]);
    const paint = rows.find((r) => r.productId === "paint")!;
    expect(paint).toMatchObject({ consistent: true, variance: 0.15 });
    expect(paint.projects.map((p) => p.actual)).toEqual([11.5, 11.2, 12]);
    // primer goes both ways → not consistent
    expect(rows.find((r) => r.productId === "primer")!.consistent).toBe(false);
    // two projects are not enough
    expect(calibrate([proj("C-1", 1500), proj("C-2", 1500)])[0].consistent).toBe(false);
    expect(suggestedCoverage(6.67, 0.15)).toBe(5.8);
  });
});

describe("Qoyod payroll & supplier payment payloads", async () => {
  const { payrollJournalBody, simpleBillPaymentBody, billPaymentRef } = await import("@/lib/qoyod/payloads");
  it("balances the payroll entry and tags the month", () => {
    const b = payrollJournalBody({ month: "2026-11", date: "2026-11-27", net: 18450.456, employees: 6, salaryAccountId: 51, bankAccountId: 8 });
    expect(b.journal_entry.debit_amounts[0]).toMatchObject({ account_id: 51, amount: 18450.46 });
    expect(b.journal_entry.credit_amounts[0]).toMatchObject({ account_id: 8, amount: 18450.46 });
    expect(b.journal_entry.description.startsWith("[PAYROLL-2026-11]")).toBe(true);
  });
  it("pays a simple bill by id with a unique reference", () => {
    expect(simpleBillPaymentBody({ reference: billPaymentRef("PO-2026-004"), billId: 24, accountId: 8, date: "2026-11-20", amount: 1150, description: "x" })).toEqual({
      simple_bill_payment: { reference: "PO-2026-004/PAID", description: "x", simple_bill_id: "24", account_id: "8", date: "2026-11-20", amount: "1150.00" },
    });
  });
});

describe("WhatsApp sign-in codes", async () => {
  const { createHmac } = await import("node:crypto");
  const { verifyWebhook } = await import("@/lib/auth/webhook");
  const { whatsappOtpPayload } = await import("@/lib/notifications/whatsapp-payload");
  const key = Buffer.from("0123456789abcdef0123456789abcdef");
  const secret = `v1,whsec_${key.toString("base64")}`;
  const sign = (id: string, ts: number, body: string) => `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;
  it("accepts Supabase's signature and refuses forged, stale or tampered calls", () => {
    const now = 1_790_000_000_000;
    const ts = now / 1000;
    const body = '{"user":{"phone":"966500000001"},"sms":{"otp":"123456"}}';
    const h = { id: "msg_1", timestamp: String(ts), signature: sign("msg_1", ts, body) };
    expect(verifyWebhook(secret, h, body, now)).toBe(true);
    expect(verifyWebhook(secret, { ...h, signature: `v1,${"A".repeat(44)}` }, body, now)).toBe(false);
    expect(verifyWebhook(secret, h, body.replace("123456", "000000"), now)).toBe(false);
    expect(verifyWebhook(secret, h, body, now + 10 * 60_000)).toBe(false);
    expect(verifyWebhook(secret, { ...h, signature: null }, body, now)).toBe(false);
  });
  it("puts the code in the body and the copy-code button", () => {
    const p = whatsappOtpPayload("966500000001", "123456", "malmas_login", "ar");
    expect(p.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "123456" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "123456" }] },
    ]);
  });
});

describe("WhatsApp share links", async () => {
  const { waHref, waPhone } = await import("@/lib/whatsapp-link");
  it("normalises Saudi numbers and encodes the message", () => {
    expect(waPhone("0551234567")).toBe("966551234567");
    expect(waPhone("٠٥٥١٢٣٤٥٦٧")).toBe("966551234567");
    expect(waPhone("+966 55 123 4567")).toBe("966551234567");
    expect(waPhone("12")).toBeNull();
    expect(waHref("966551234567", "مرحباً & شكراً")).toBe("https://wa.me/966551234567?text=" + encodeURIComponent("مرحباً & شكراً"));
    expect(waHref(null, "x")).toBeNull();
  });
});
