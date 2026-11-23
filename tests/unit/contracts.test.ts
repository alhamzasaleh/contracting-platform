import { describe, expect, it } from "vitest";
import { firstPaymentWarning, linkExpiry, percentSum, scheduleAmounts, suggestedDays } from "@/lib/contracts";

describe("contract helpers", () => {
  it("splits the total by percentages, last payment absorbs rounding", () => {
    expect(scheduleAmounts(10000, [33.33, 33.33, 33.34])).toEqual([3333, 3333, 3334]);
    expect(scheduleAmounts(1000.01, [50, 50]).reduce((a, b) => a + b, 0)).toBeCloseTo(1000.01, 2);
    expect(percentSum([40, 30, 20, 10])).toBe(100);
  });

  it("warns when the first payment covers less than 75 % of materials", () => {
    expect(firstPaymentWarning(3000, 5000)).toEqual({ warn: true, coverage: 60 });
    expect(firstPaymentWarning(4000, 5000)).toEqual({ warn: false, coverage: 80 });
    expect(firstPaymentWarning(1000, 0).warn).toBe(false);
  });

  it("suggests days from area and productivity", () => {
    expect(suggestedDays(850, 120)).toBe(8);
    expect(suggestedDays(0, 40)).toBe(1);
  });

  it("keeps the client link alive until the warranty ends", () => {
    const d = linkExpiry("2026-12-01", 10, 6, new Date("2026-11-23T00:00:00Z"));
    expect(d.toISOString().slice(0, 10)).toBe("2027-07-10");
  });
});
