import { describe, expect, it } from "vitest";
import { fillPlaceholders, termsSchema } from "@/lib/contracts/terms";

describe("contract terms", () => {
  it("fills known placeholders and leaves unknown ones", () => {
    expect(fillPlaceholders("مدة {days} يوم تبدأ {start} — {foo}", { days: "12", start: "1 ديسمبر" })).toBe("مدة 12 يوم تبدأ 1 ديسمبر — {foo}");
  });
  it("accepts overrides and custom clauses, rejects unknown keys", () => {
    expect(termsSchema.safeParse({ overrides: { warranty: { body: "ضمان سنة", hidden: false } }, custom: [{ id: "c-1234", title: "الكهرباء", body: "على المالك", after: "second" }] }).success).toBe(true);
    expect(termsSchema.safeParse({ overrides: { nope: { body: "x" } } }).success).toBe(false);
    expect(termsSchema.safeParse({ custom: [{ id: "c-1234", title: "", body: "x", after: "law" }] }).success).toBe(false);
  });
});
