import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paperScale, PAPER_WIDTH } from "@/lib/paper";

describe("the paper scales as a whole to the screen (owner, Nov 2026)", () => {
  it("fits the container, never grows past its own size", () => {
    expect(paperScale(380, PAPER_WIDTH)).toBeCloseTo(380 / PAPER_WIDTH, 5);
    expect(paperScale(2000, PAPER_WIDTH)).toBe(1);
    expect(paperScale(PAPER_WIDTH, PAPER_WIDTH)).toBe(1);
  });
  it("an unmeasured container keeps the natural size", () => {
    expect(paperScale(0, PAPER_WIDTH)).toBe(1);
    expect(paperScale(Number.NaN, PAPER_WIDTH)).toBe(1);
  });

  // every document keeps one layout: no screen breakpoints inside it (the sheet is always
  // its own width; only print:… variants may change it)
  const DOCS = [
    "src/components/projects/measurement-document.tsx",
    "src/components/projects/handover-certificate.tsx",
    "src/components/quotes/framing-document.tsx",
    "src/components/quotes/materials-document.tsx",
    "src/components/quotes/quote-document.tsx",
    "src/components/finance/invoice-document.tsx",
    "src/components/finance/receipt-voucher.tsx",
    "src/components/contracts/contract-terms.tsx",
    "src/components/marketers/payment-voucher.tsx",
    "src/components/subcontractors/documents.tsx",
  ];
  it.each(DOCS)("%s sits on a Paper and has no screen breakpoints", (f) => {
    const src = readFileSync(f, "utf8");
    expect(src).toMatch(/<Paper\b/);
    expect(src.match(/\b(?:sm|md|lg|xl|2xl|max-sm|max-md|min-\[\d+px\]|max-\[\d+px\]):[\w[\]-]/g) ?? []).toEqual([]);
    // sizes tied to the viewport (vw) would shrink twice inside a scaled sheet
    expect(src.match(/\d+vw/g) ?? []).toEqual([]);
  });
});
