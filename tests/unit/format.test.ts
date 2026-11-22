import { describe, expect, it } from "vitest";
import { createFormatter } from "@/lib/format";
import { effectivePermissions } from "@/lib/auth/permissions";

describe("formatter", () => {
  it("uses Western digits when chosen, in Arabic", () => {
    const f = createFormatter("ar", "latn");
    expect(f.number(12500)).toMatch(/12[,٬]500/);
    expect(f.money(1500)).toContain("1");
  });

  it("uses Arabic-Indic digits when chosen", () => {
    const f = createFormatter("ar", "arab");
    expect(f.number(2026)).toMatch(/[٠-٩]/);
    expect(f.digits("Q-2026-001")).toBe("Q-٢٠٢٦-٠٠١");
  });

  it("formats English with Latin digits", () => {
    const f = createFormatter("en", "latn");
    expect(f.percent(0.2)).toBe("20%");
  });
});

describe("effective permissions", () => {
  it("owner has everything regardless of denies", () => {
    expect(effectivePermissions("owner", { grant: [], deny: ["settings.manage"] })).toContain("settings.manage");
  });
  it("applies grants and denies to other roles", () => {
    const p = effectivePermissions("viewer", { grant: ["reports.view"], deny: ["clients.view"] });
    expect(p).toContain("reports.view");
    expect(p).not.toContain("clients.view");
  });
});
