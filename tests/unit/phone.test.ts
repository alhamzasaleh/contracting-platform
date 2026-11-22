import { describe, expect, it } from "vitest";
import { normalizeSaudiMobile, safeNext } from "@/lib/validation/phone";

describe("Saudi mobile normalisation", () => {
  it.each([
    ["0512345678", "966512345678"],
    ["512345678", "966512345678"],
    ["+966 51 234 5678", "966512345678"],
    ["00966512345678", "966512345678"],
    ["٠٥١٢٣٤٥٦٧٨", "966512345678"],
  ])("%s → %s", (input, out) => expect(normalizeSaudiMobile(input)).toBe(out));

  it.each(["0112345678", "12345", "+14155550123", "05123", ""])("rejects %s", (input) =>
    expect(normalizeSaudiMobile(input)).toBeNull(),
  );
});

describe("safe redirect", () => {
  it("keeps same-origin paths", () => expect(safeNext("/settings?x=1")).toBe("/settings?x=1"));
  it.each(["https://evil.com", "//evil.com", "/\\evil.com", undefined, 42])("blocks %s", (v) =>
    expect(safeNext(v)).toBe("/"),
  );
});
