import { describe, expect, it } from "vitest";
import { addendumPaid, ageing, canRequestPayment, expectedPaymentDate, lateDays, paydays, paymentRequestError, projectProfit, remainingAmount, weeklyForecast } from "@/lib/finance";

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

  it("staff can ask for a pending payment unless the client's stage confirmation does it", () => {
    const stages = new Set(["board_closing", "handover"]);
    expect(canRequestPayment({ due_event: "material_supply", status: "pending" }, stages)).toBe(true);
    expect(canRequestPayment({ due_event: "custom", status: "pending" }, stages)).toBe(true);
    // a stage payment whose stage isn't on the project
    expect(canRequestPayment({ due_event: "primer_done", status: "pending" }, stages)).toBe(true);
    expect(canRequestPayment({ due_event: "board_closing", status: "pending" }, stages)).toBe(false);
    expect(canRequestPayment({ due_event: "signing", status: "pending" }, stages)).toBe(false);
    expect(canRequestPayment({ due_event: "custom", status: "requested" }, stages)).toBe(false);
  });

  it("explains why the database refused a payment request", () => {
    expect(paymentRequestError("the contract isn't accepted")).toBe("paymentNotAccepted");
    expect(paymentRequestError("stage payments are requested when the client confirms the stage")).toBe("paymentByStage");
    expect(paymentRequestError("already requested")).toBe("paymentAlreadyRequested");
    expect(paymentRequestError("something else")).toBeNull();
    expect(paymentRequestError(undefined)).toBeNull();
  });

  it("a requested payment is late from 7 days (days counted from the request)", () => {
    expect(lateDays("2026-11-16T09:00:00Z", "2026-11-23")).toBe(7);
    expect(lateDays("2026-11-17T09:00:00Z", "2026-11-23")).toBeNull();
    // requested 17 Nov 01:30 Riyadh (16 Nov 22:30 UTC): 6 days on the 23rd, not 7
    expect(lateDays("2026-11-16T22:30:00Z", "2026-11-23")).toBeNull();
    expect(lateDays("2026-11-16T22:30:00Z", "2026-11-24")).toBe(7);
    expect(lateDays("2026-10-24", "2026-11-23")).toBe(30);
    expect(lateDays(null, "2026-11-23")).toBeNull();
  });

  it("reminders ask for what is left, and a legacy 'paid' addendum is fully paid", () => {
    expect(remainingAmount(1000, 400)).toBe(600);
    expect(remainingAmount(1000, null)).toBe(1000);
    expect(remainingAmount(1000, 1000.004)).toBe(0);
    expect(addendumPaid({ payment_status: "paid", paid_amount: null, total: 700 })).toBe(700);
    expect(addendumPaid({ payment_status: "requested", paid_amount: 200, total: 700 })).toBe(200);
  });
});
