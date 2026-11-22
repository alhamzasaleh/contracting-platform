import { describe, expect, it } from "vitest";
import { companySchema, isSafeSvg, sniffImageType } from "@/lib/validation/company";

describe("company schema", () => {
  it("accepts valid Saudi identifiers (incl. Arabic digits)", () => {
    const r = companySchema.safeParse({ name: "شركة", cr_number: "١٠١٠١٢٣٤٥٦", vat_number: "310000000000003", email: "" });
    expect(r.success).toBe(true);
    expect(r.data?.cr_number).toBe("1010123456");
    expect(r.data?.email).toBeNull();
  });
  it("rejects bad VAT and CR", () => {
    const r = companySchema.safeParse({ name: "شركة", cr_number: "123", vat_number: "123456789012345" });
    expect(r.success).toBe(false);
    const msgs = r.error!.issues.map((i) => i.message);
    expect(msgs).toContain("crInvalid");
    expect(msgs).toContain("vatInvalid");
  });
  it("rejects unknown fields", () => {
    expect(companySchema.safeParse({ name: "x y", organization_id: "evil" }).success).toBe(false);
  });
});

describe("logo checks", () => {
  it("sniffs real image types", () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe("image/png");
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBe("image/svg+xml");
    expect(sniffImageType(new TextEncoder().encode("<html><script>"))).toBeNull();
  });
  it("blocks dangerous SVGs", () => {
    expect(isSafeSvg("<svg><circle r='4'/></svg>")).toBe(true);
    expect(isSafeSvg("<svg><script>alert(1)</script></svg>")).toBe(false);
    expect(isSafeSvg("<svg onload='x()'></svg>")).toBe(false);
    expect(isSafeSvg("<svg><image href='https://evil/x.png'/></svg>")).toBe(false);
  });
});
