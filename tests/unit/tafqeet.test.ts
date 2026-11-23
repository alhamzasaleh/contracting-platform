import { describe, expect, it } from "vitest";
import { amountInWords, arabicNumberWords, englishNumberWords } from "@/lib/tafqeet";

describe("amount in words", () => {
  it("arabic", () => {
    expect(arabicNumberWords(101)).toBe("مائة وواحد");
    expect(arabicNumberWords(200)).toBe("مئتان");
    expect(arabicNumberWords(1000)).toBe("ألف");
    expect(arabicNumberWords(2000)).toBe("ألفان");
    expect(arabicNumberWords(3500)).toBe("ثلاثة آلاف وخمسمائة");
    expect(arabicNumberWords(18400)).toBe("ثمانية عشر ألف وأربعمائة");
    expect(arabicNumberWords(21)).toBe("واحد وعشرون");
    expect(arabicNumberWords(1250000)).toBe("مليون ومئتان وخمسون ألف");
    expect(amountInWords(18400, "ar")).toBe("فقط ثمانية عشر ألف وأربعمائة ريال سعودي لا غير");
    expect(amountInWords(5750.5, "ar")).toBe("فقط خمسة آلاف وسبعمائة وخمسون ريال سعودي وخمسون هللة لا غير");
  });

  it("english", () => {
    expect(englishNumberWords(18400)).toBe("eighteen thousand four hundred");
    expect(amountInWords(1250.25, "en")).toBe("One thousand two hundred and fifty Saudi riyals and twenty-five halalas only");
  });
});

import { receiptTotals } from "@/lib/receipts";
describe("receipt totals", () => {
  it("counts only vouchers up to this one", () => {
    const base = { label: "x", paid_on: "2026-11-01", method: null, reference: null };
    const all = [
      { ...base, number: "RV-2026-002", amount: 4000, created_at: "2026-11-05T10:00:00Z" },
      { ...base, number: "RV-2026-001", amount: 6000, created_at: "2026-11-01T10:00:00Z" },
    ];
    expect(receiptTotals(all, "RV-2026-001", 15000)).toMatchObject({ receivedToDate: 6000, remaining: 9000 });
    expect(receiptTotals(all, "RV-2026-002", 15000)).toMatchObject({ receivedToDate: 10000, remaining: 5000 });
    expect(receiptTotals(all, "RV-2026-009", 15000)).toBeNull();
  });
});

import { payrollCsv } from "@/lib/hr";
describe("payroll CSV", () => {
  it("neutralises spreadsheet formulas in names", () => {
    const csv = payrollCsv([{ full_name: "=HYPERLINK(\"x\")", iban: null, net: 1 }], "2026-11");
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
