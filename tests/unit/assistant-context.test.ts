import { describe, expect, it } from "vitest";
import { monthTotals, SAFE_LINK } from "@/lib/assistant/context";

describe("assistant facts", () => {
  it("sums amounts per month and skips undated rows", () => {
    expect(monthTotals([{ date: "2026-11-02", amount: 100 }, { date: "2026-11-20T10:00:00Z", amount: 50.5 }, { date: "2026-10-01", amount: 1 }, { date: null, amount: 9 }])).toEqual({ "2026-11": 150.5, "2026-10": 1 });
  });
  it("only in-app links are allowed", () => {
    expect(SAFE_LINK.test("/reports")).toBe(true);
    expect(SAFE_LINK.test("/projects/C-2026-004")).toBe(true);
    expect(SAFE_LINK.test("https://evil.example")).toBe(false);
    expect(SAFE_LINK.test("//evil.example")).toBe(false);
    expect(SAFE_LINK.test("/projects/C-2026-004?x=1")).toBe(false);
  });
});
