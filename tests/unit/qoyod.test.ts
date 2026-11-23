import { describe, expect, it } from "vitest";
import { approveSimpleBillBody, customerBody, documentStatus, errorText, paymentStep, waitsForApproved, invoiceBody, invoicePaymentBody, invoiceRef, localPhone, netOf, paymentRef, simpleBillBody } from "@/lib/qoyod/payloads";

describe("qoyod payloads", () => {
  it("phone and VAT helpers", () => {
    expect(localPhone("966501234567")).toBe("0501234567");
    expect(localPhone(null)).toBeUndefined();
    expect(netOf(1150, 15)).toBe(1000);
    expect(netOf(1000, 0)).toBe(1000);
  });

  it("invoice: one line per payment, VAT-inclusive price, VAT percent stated", () => {
    const b = invoiceBody({
      contactId: 7, reference: invoiceRef("C-2026-001", 2), description: "C-2026-001 — بعد توريد المواد", issueDate: "2026-11-20", dueDate: "2026-11-10",
      status: "Draft", inventoryId: 1, productId: 33, lineDescription: "بعد توريد المواد", gross: 11500, vatPercent: 15,
    });
    expect(b.invoice.reference).toBe("C-2026-001/2");
    expect(b.invoice.due_date).toBe("2026-11-20"); // never before the issue date
    expect(b.invoice.line_items).toEqual([{ product_id: 33, description: "بعد توريد المواد", quantity: 1, unit_price: 11500, tax_percent: 15, is_inclusive: true }]);
  });

  it("payments carry a unique reference per cumulative amount", () => {
    expect(paymentRef("C-2026-001/2", 5000)).toBe("C-2026-001/2/PAY-5000.00");
    expect(invoicePaymentBody({ reference: "x", invoiceId: 9, accountId: 7, date: "2026-11-21", amount: 5000.004 }).invoice_payment.amount).toBe(5000);
  });

  it("simple bill: net + 15 % when the supplier charged VAT, whole amount otherwise", () => {
    const base = { contactId: 1, reference: "PO-2026-001", issueDate: "2026-11-01", status: "Draft" as const, inventoryId: 1, expenseAccountId: 50, description: "PO-2026-001" };
    expect(simpleBillBody({ ...base, subtotal: 100, vat: 15, total: 115 }).simple_bill.simple_bill_items_attributes[0]).toMatchObject({ total_amount: 100, tax_id: "1" });
    expect(simpleBillBody({ ...base, subtotal: 100, vat: 0, total: 100 }).simple_bill.simple_bill_items_attributes[0]).toMatchObject({ total_amount: 100, tax_id: "2" });
  });

  it("customer body and error text stay short and safe", () => {
    expect(customerBody({ name: "محمد", phone: "966500000001", city: "الرياض", number: "CL-1" }).contact).toMatchObject({ name: "محمد", phone_number: "0500000001" });
    expect(errorText(422, { errors: { reference: ["has already been taken"] } })).toContain("HTTP 422");
    expect(errorText(500, "x".repeat(1000)).length).toBeLessThanOrEqual(300);
  });

  it("payments and journal entries wait until sending is Approved (a draft can't be paid)", () => {
    for (const kind of ["invoice_payment", "bill_payment", "payroll"]) {
      expect(waitsForApproved(kind, "Draft")).toBe(true);
      expect(waitsForApproved(kind, "Approved")).toBe(false);
    }
    expect(waitsForApproved("invoice", "Draft")).toBe(false);
    expect(waitsForApproved("bill", "Draft")).toBe(false);
  });

  it("a document we sent as a draft is approved (bills) or waited for (invoices) before its payment", () => {
    expect(documentStatus({ invoice: { id: 1, status: "Draft" } }, "invoice")).toBe("Draft");
    expect(documentStatus({ simple_bill: { id: 2, status: "Approved" } }, "simple_bill")).toBe("Approved");
    expect(documentStatus({}, "invoice")).toBeNull();
    // Qoyod's API can update a simple bill's status but has no update for invoices
    expect(approveSimpleBillBody()).toEqual({ simple_bill: { status: "Approved" } });
    expect(paymentStep("bill_payment", "Draft")).toBe("approve");
    expect(paymentStep("invoice_payment", "Draft")).toBe("wait");
    for (const st of ["Approved", "Partially Paid", "Paid", null]) {
      expect(paymentStep("bill_payment", st)).toBe("post");
      expect(paymentStep("invoice_payment", st)).toBe("post");
    }
  });
});
