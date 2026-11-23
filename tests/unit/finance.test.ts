import { describe, expect, it } from "vitest";
import { ageing, expectedPaymentDate, paydays, projectProfit, weeklyForecast } from "@/lib/finance";

const c = { start_date: "2026-12-01", days: 20 };
const p = (due_event: Parameters<typeof expectedPaymentDate>[0]["due_event"], extra: Partial<Parameters<typeof expectedPaymentDate>[0]> = {}) => ({ due_event, expected_date: null, status: "pending", requested_at: null, ...extra });

describe("finance", () => {
  it("expected payment dates follow the contract timeline", () => {
    expect(expectedPaymentDate(p("signing"), c, "2026-11-23")).toBe("2026-12-01");
    expect(expectedPaymentDate(p("board_closing"), c, "2026-11-23")).toBe("2026-12-11");
    expect(expectedPaymentDate(p("handover"), c, "2026-11-23")).toBe("2026-12-21");
    expect(expectedPaymentDate(p("handover", { expected_date: "2027-01-05" }), c, "2026-11-23")).toBe("2027-01-05");
    expect(expectedPaymentDate(p("handover", { status: "requested" }), c, "2026-11-23")).toBe("2026-11-23");
    // a past date is due now
    expect(expectedPaymentDate(p("signing"), { start_date: "2026-10-01", days: 5 }, "2026-11-23")).toBe("2026-11-23");
  });

  it("weekly forecast carries the balance and flags shortfalls; overdue lands in week 1", () => {
    const f = weeklyForecast(
      1000,
      [{ date: "2026-11-10", amount: 500, label: "متأخرة", kind: "client" }, { date: "2026-12-02", amount: 3000, label: "دفعة", kind: "client" }],
      [{ date: "2026-11-27", amount: 2000, label: "رواتب", kind: "payroll" }],
      "2026-11-23",
      3,
    );
    expect(f[0]).toMatchObject({ start: "2026-11-21", inflow: 500, outflow: 2000, balance: -500, shortfall: true });
    expect(f[1]).toMatchObject({ inflow: 3000, balance: 2500, shortfall: false });
    expect(f).toHaveLength(3);
  });

  it("paydays in the window", () => {
    expect(paydays("2026-11-23", 27, "2027-01-31")).toEqual(["2026-11-27", "2026-12-27", "2027-01-27"]);
    expect(paydays("2026-11-28", 27, "2026-12-31")).toEqual(["2026-12-27"]);
  });

  it("ageing buckets", () => {
    const b = ageing(
      [
        { requested_at: "2026-11-20T10:00:00Z", outstanding: 100 },
        { requested_at: "2026-10-01T10:00:00Z", outstanding: 200 },
        { requested_at: "2026-07-01T10:00:00Z", outstanding: 300 },
        { requested_at: "2026-11-01T10:00:00Z", outstanding: 0 },
      ],
      "2026-11-23",
    );
    expect(b).toEqual({ "0_30": 100, "31_60": 200, "61_90": 0, "90_plus": 300 });
  });

  it("profit expected vs actual", () => {
    expect(projectProfit(10000, 7000, 7500)).toMatchObject({ expected: 3000, expectedMargin: 30, actual: 2500, actualMargin: 25, losing: false });
    expect(projectProfit(10000, 7000, 11000).losing).toBe(true);
    expect(projectProfit(10000, null, 4000).expected).toBeNull();
  });
});
