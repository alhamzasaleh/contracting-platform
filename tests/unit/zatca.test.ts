import { describe, expect, it } from "vitest";
import { zatcaQrDecode, zatcaQrPayload } from "@/lib/zatca";

describe("ZATCA QR", () => {
  it("encodes the five TLV fields (Arabic seller name in UTF-8)", () => {
    const b64 = zatcaQrPayload({ seller: "مؤسسة ملمس", vatNumber: "310000000000003", timestamp: "2026-11-23T10:15:30.123Z", total: 1150, vat: 150 });
    expect(zatcaQrDecode(b64)).toEqual({ 1: "مؤسسة ملمس", 2: "310000000000003", 3: "2026-11-23T10:15:30Z", 4: "1150.00", 5: "150.00" });
    // tag 1 length is the UTF-8 byte length, not the character count
    const raw = Buffer.from(b64, "base64");
    expect(raw[0]).toBe(1);
    expect(raw[1]).toBe(Buffer.byteLength("مؤسسة ملمس"));
  });
});

describe("PDF document allow-list", async () => {
  const { STAFF_DOCS } = await import("@/lib/pdf-docs");
  it("accepts only known print pages with real document numbers", () => {
    for (const ok of ["quotations/Q-2026-001", "contracts/C-2026-012", "invoices/INV-2026-001", "receipts/RV-2026-004", "handover/C-2026-001", "payroll/2026-11"]) expect(STAFF_DOCS.test(ok)).toBe(true);
    for (const bad of ["../api/health", "quotations/../../x", "settings/Q-2026-001", "invoices/INV-2026-001?x=1", "payroll/2026-13", "//evil.com/x", "contracts/c-2026-001"]) expect(STAFF_DOCS.test(bad)).toBe(false);
  });
});
