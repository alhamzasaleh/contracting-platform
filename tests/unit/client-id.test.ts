import { describe, expect, it } from "vitest";
import { clientIdNumber, idNumberComplete, idNumberValid } from "@/lib/validation/national-id";
import { quoteDecisionError } from "@/lib/portal-flow";

describe("the client's ID number on his page", () => {
  it("accepts a Saudi ID / iqama with a correct check digit, Arabic digits and spaces too", () => {
    expect(idNumberValid("1000000008")).toBe(true);
    expect(idNumberValid("2000000006")).toBe(true);
    expect(clientIdNumber.parse("١٠٠٠ ٠٠٠ ٠٠٨")).toBe("1000000008");
    // Persian / Urdu keyboards type ۰-۹ (a resident typing his iqama)
    expect(clientIdNumber.parse("۲۰۰۰۰۰۰۰۰۶")).toBe("2000000006");
  });
  it("a failed check digit is only a warning: a commercial registration (1010…, 2050…) is accepted", () => {
    expect(idNumberValid("1000000009")).toBe(false);
    expect(clientIdNumber.parse("1010123456")).toBe("1010123456");
    expect(clientIdNumber.parse("2050012345")).toBe("2050012345");
    expect(idNumberComplete("1010123456")).toBe(true);
  });
  it("refuses a short or long number and empty", () => {
    expect(idNumberValid("10000000")).toBe(false);
    expect(clientIdNumber.safeParse("").success).toBe(false);
    expect(clientIdNumber.safeParse("123456789").success).toBe(false);
    expect(clientIdNumber.safeParse("12345678901").success).toBe(false);
    expect(idNumberComplete("123456789")).toBe(false);
  });
  it("a 10-digit number not starting with 1 or 2 (e.g. a company's unified number) is kept", () => {
    expect(idNumberValid("7001234567")).toBe(true);
  });
  it("the database's refusal becomes «idRequired»", () => {
    expect(quoteDecisionError({ code: "22023", message: "id required" })).toBe("idRequired");
  });
});

describe("Persian / Urdu digits are read like Arabic ones everywhere (same mistake, fixed together)", () => {
  it("client phone and WhatsApp link", async () => {
    const { clientPhone } = await import("@/lib/validation/client-phone");
    const { waHref } = await import("@/lib/whatsapp-link");
    expect(clientPhone.parse("۰۵۵۱۲۳۴۵۶۷")).toBe("966551234567");
    expect(waHref("۹۶۶۵۵۱۲۳۴۵۶۷", "x")).toContain("966551234567");
  });
});
