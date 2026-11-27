import { describe, expect, it } from "vitest";
import { clientPhone } from "@/lib/validation/client-phone";

/* The client's phone is required (owner, Nov 2026: «رقم جوال العميل ضروري»). */
describe("client phone required", () => {
  it("empty is refused as required; a wrong number as invalid", () => {
    expect(clientPhone.safeParse("").error?.issues[0].message).toBe("required");
    expect(clientPhone.safeParse(undefined).error?.issues[0].message).toBe("required");
    expect(clientPhone.safeParse("12").error?.issues[0].message).toBe("phoneInvalid");
  });
  it("a Saudi mobile in any form is stored as 9665…; an international number as typed", () => {
    expect(clientPhone.parse("0537 000 111")).toBe("966537000111");
    expect(clientPhone.parse("٠٥٣٧٠٠٠١١١")).toBe("966537000111");
    expect(clientPhone.parse("537000111")).toBe("966537000111");
    expect(clientPhone.parse("+971 50 123 4567")).toBe("971501234567");
  });
});

describe("review fixes", () => {
  it("an international number opens in the form as itself, so saving it again keeps it", async () => {
    const { phoneForInput } = await import("@/lib/validation/client-phone");
    expect(phoneForInput("971501234567")).toBe("+971501234567");
    expect(clientPhone.parse(phoneForInput("971501234567"))).toBe("971501234567");
    expect(phoneForInput("966537000111")).toBe("0537000111");
    expect(clientPhone.parse(phoneForInput("966537000111"))).toBe("966537000111");
    expect(phoneForInput(null)).toBe("");
  });
  it("numbers WhatsApp couldn't reach are fixed or refused", () => {
    expect(clientPhone.parse("00971501234567")).toBe("971501234567");
    expect(clientPhone.parse("+966 0537000111")).toBe("966537000111");
    expect(clientPhone.safeParse("0112345678").error?.issues[0].message).toBe("phoneInvalid");
  });
});
