import { describe, expect, it } from "vitest";
import { invoicePaid, invoiceStatus } from "@/lib/invoices";

describe("invoice paid amount", () => {
  it("a payment marked paid pays the whole invoice, even without a recorded amount (legacy rows)", () => {
    expect(invoicePaid(1500, { amount: 0, full: true })).toBe(1500);
    expect(invoiceStatus({ total: 1500, paid: invoicePaid(1500, { amount: 0, full: true }), due_date: "2026-01-01" }, "2026-11-23")).toBe("paid");
    expect(invoicePaid(1500, { amount: 500, full: false })).toBe(500);
    expect(invoicePaid(1500, undefined)).toBe(0);
  });
});
