import { describe, expect, it } from "vitest";
import { cashStatutoryItems } from "@/lib/finance";
import { assistantLinks } from "@/lib/assistant/context";
import { issueBlockers } from "@/lib/quotes";
import { itemsToLink, markBought, mergeRows, type ListLine } from "@/lib/purchases";
import { deliveryDate, deliveryWithAddenda, portalLinkState } from "@/lib/contracts";
import { anyTeamFree, spanOf, suggestStart } from "@/lib/schedule";
import { autoSetupDue, pettyTag, pettyTransferBody, simpleBillBody, subcontractExpenseAccount, subcontractorBillAmounts, TAX, waitsForApproved } from "@/lib/qoyod/payloads";

/** Review of batch 2 (Nov 2026): fixes found by the second review. */

describe("#2 the cash-flow forecast pays only cash, not provisions", () => {
  const item = (code: string, basis: "percent" | "monthly" | "annual" | "one_time", is_provision = false) => ({ code, applies_to: "all" as const, basis, value: 10, amortize_months: null, is_active: true, is_provision });
  it("keeps monthly cash items (GOSI %, monthly fees) and drops provisions and annual/one-off items", () => {
    const items = [item("gosi_saudi", "percent"), item("housing", "monthly"), item("eos_accrual", "percent", true), item("annual_leave", "percent", true), item("medical_insurance", "annual"), item("recruitment", "one_time"), item("custom_reserve", "monthly", true)];
    expect(cashStatutoryItems(items).map((i) => i.code)).toEqual(["gosi_saudi", "housing"]);
  });
});

describe("#3 issuing a quote priced with our own team doesn't need hr.view", () => {
  const labour = { step: "labour", role: "labour", reason: "labour" as const };
  const paint = { step: "finish", role: "finish", reason: "no_price" as const };
  it("an issuer who can't see crew costs relies on the frozen version for labour (the database refuses unpriced versions)", () => {
    const inhouse = { labour: { source: "inhouse", crew: ["e1"] } } as never;
    expect(issueBlockers([labour], inhouse, false)).toEqual([]);
    expect(issueBlockers([labour, paint], inhouse, false)).toEqual([paint]);
    // with crew costs visible the re-check still counts
    expect(issueBlockers([labour], inhouse, true)).toEqual([labour]);
    // external / template labour is recomputable by anyone
    expect(issueBlockers([labour], { labour: { source: "external", externalId: "r1" } } as never, false)).toEqual([labour]);
  });
});

describe("#4 Qoyod subcontractor bills and the automatic setup", () => {
  it("a subcontractor bill uses the subcontracting account, else the expense account", () => {
    expect(subcontractExpenseAccount({ subcontract_account_id: 55, expense_account_id: 40 })).toBe(55);
    expect(subcontractExpenseAccount({ subcontract_account_id: null, expense_account_id: 40 })).toBe(40);
    expect(subcontractExpenseAccount({ subcontract_account_id: null, expense_account_id: null })).toBeNull();
  });

  const full = { inventory_id: 1, receive_account_id: 2, expense_account_id: 3, salary_account_id: 4, cash_account_id: 5, subcontract_account_id: 6, addendum_product_id: 7, service_products: { gypsum: 1, interior: 2, exterior: 3 }, auto_setup_at: null as string | null, commission_setup_at: "2026-11-23T00:00:00Z" };
  it("runs when a required setting is missing, every time", () => {
    expect(autoSetupDue({ ...full, auto_setup_at: "2026-11-23T09:00:00Z" })).toBe(false);
    expect(autoSetupDue({ ...full, inventory_id: null, auto_setup_at: "2026-11-23T09:59:00Z" })).toBe(true);
    expect(autoSetupDue({ ...full, service_products: { gypsum: 1, interior: 2 }, auto_setup_at: "2026-11-23T09:00:00Z" })).toBe(true);
  });
  it("optional accounts (salary, cash, subcontracting) missing: only at the first setup (the owner's clearing sticks)", () => {
    const opt = { ...full, salary_account_id: null, subcontract_account_id: null };
    expect(autoSetupDue({ ...opt, auto_setup_at: null })).toBe(true);
    expect(autoSetupDue({ ...opt, auto_setup_at: "2026-11-23T01:00:00Z" })).toBe(false);
    expect(autoSetupDue({ ...opt, auto_setup_at: "2026-11-22T09:00:00Z" })).toBe(false);
  });
});

describe("#5 petty-cash top-ups and returns reach Qoyod as bank ↔ cash journal entries", () => {
  const id = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
  it("a top-up moves money from the bank to the cash account, tagged for a retry to find it", () => {
    const b = pettyTransferBody({ entryId: id, kind: "topup", date: "2026-11-20", amount: 1000.005, holder: "عهدة المشرف", bankAccountId: 2, cashAccountId: 5 });
    expect(b.journal_entry.description.startsWith(pettyTag(id))).toBe(true);
    expect(pettyTag(id)).toBe(`[PETTY-${id}]`);
    expect(b.journal_entry.date).toBe("2026-11-20");
    expect(b.journal_entry.debit_amounts).toEqual([expect.objectContaining({ account_id: 5, amount: 1000.01 })]);
    expect(b.journal_entry.credit_amounts).toEqual([expect.objectContaining({ account_id: 2, amount: 1000.01 })]);
  });
  it("a return moves it back (cash → bank)", () => {
    const b = pettyTransferBody({ entryId: id, kind: "return", date: "2026-11-21", amount: 150, holder: "عهدة", bankAccountId: 2, cashAccountId: 5 });
    expect(b.journal_entry.debit_amounts[0].account_id).toBe(2);
    expect(b.journal_entry.credit_amounts[0].account_id).toBe(5);
  });
  it("waits for Approved sending like payroll", () => {
    expect(waitsForApproved("transfer", "Draft")).toBe(true);
    expect(waitsForApproved("transfer", "Approved")).toBe(false);
  });
});

describe("#6 VAT on subcontractor bills", () => {
  it("VAT-registered company + subcontractor with a VAT number: the amount is VAT-inclusive", () => {
    expect(subcontractorBillAmounts(1150, 15, "300000000000003")).toEqual({ subtotal: 1000, vat: 150, total: 1150 });
    const odd = subcontractorBillAmounts(1000, 15, "300000000000003");
    expect(odd.subtotal + odd.vat).toBeCloseTo(1000, 2);
    expect(odd).toMatchObject({ subtotal: 869.57, vat: 130.43, total: 1000 });
  });
  it("otherwise no VAT", () => {
    expect(subcontractorBillAmounts(1150, 0, "300000000000003")).toEqual({ subtotal: 1150, vat: 0, total: 1150 });
    expect(subcontractorBillAmounts(1150, 15, null)).toEqual({ subtotal: 1150, vat: 0, total: 1150 });
    expect(subcontractorBillAmounts(1150, 15, "  ")).toEqual({ subtotal: 1150, vat: 0, total: 1150 });
  });
  it("the bill sends the net amount with 15 % VAT when there is VAT", () => {
    const a = subcontractorBillAmounts(1150, 15, "300000000000003");
    const body = simpleBillBody({ contactId: 1, reference: "SUB-X", issueDate: "2026-11-20", status: "Draft", inventoryId: 1, expenseAccountId: 6, description: "x", ...a });
    expect(body.simple_bill.simple_bill_items_attributes[0]).toMatchObject({ total_amount: 1000, tax_id: TAX.vat15 });
  });
});

describe("#7 one delivery date everywhere", () => {
  it("the project page and the contract page use the same formula (start + days + accepted addenda days)", () => {
    expect(deliveryDate("2026-11-01", 10, 0)).toBe("2026-11-11");
    expect(deliveryDate("2026-11-25", 10, 5)).toBe("2026-12-10");
    const addenda = [{ status: "accepted" as const, extra_days: 3 }, { status: "sent" as const, extra_days: 9 }, { status: "accepted" as const, extra_days: 2 }];
    expect(deliveryWithAddenda("2026-11-25", 10, addenda)).toEqual({ date: deliveryDate("2026-11-25", 10, 5), extra: 5 });
  });
});

describe("#8 reissuing the client-page link", () => {
  it("before acceptance: the quote/contract message; after: follow the project; after the warranty: no reissue", () => {
    expect(portalLinkState("sent", null, "2026-11-23")).toEqual({ canIssue: true, message: "contractLink", warrantyEnded: false });
    expect(portalLinkState("accepted", null, "2026-11-23")).toEqual({ canIssue: true, message: "projectLink", warrantyEnded: false });
    expect(portalLinkState("accepted", "2026-11-23", "2026-11-23")).toEqual({ canIssue: true, message: "projectLink", warrantyEnded: false });
    expect(portalLinkState("accepted", "2026-11-22", "2026-11-23")).toEqual({ canIssue: false, message: "projectLink", warrantyEnded: true });
    expect(portalLinkState("cancelled", null, "2026-11-23").canIssue).toBe(false);
  });
});

describe("#9 the priced team drives the earliest start", () => {
  const teams = [
    { id: "a", name: "A", kind: "inhouse" as const, services: ["gypsum" as const], is_active: true, color: null },
    { id: "b", name: "B", kind: "inhouse" as const, services: ["gypsum" as const], is_active: true, color: null },
  ];
  const entries = [{ id: "e1", team_id: "b", contract_id: "x", kind: "work" as const, start: "2026-12-01", end: "2026-12-20" }];
  it("suggests the priced team's earliest free day (not another team's) and warns on its own clashes", () => {
    expect(suggestStart(teams as never, entries as never, "gypsum", "2026-12-01", 5)?.team.id).toBe("a");
    const s = suggestStart(teams as never, entries as never, "gypsum", "2026-12-01", 5, undefined, "b");
    expect(s?.team.id).toBe("b");
    expect(s?.date).toBe("2026-12-21");
    expect(anyTeamFree(teams as never, entries as never, "gypsum", spanOf("2026-12-02", 3), undefined, "b")).toBe(false);
    expect(anyTeamFree(teams as never, entries as never, "gypsum", spanOf("2026-12-02", 3))).toBe(true);
    // unknown / inactive team → the usual pool
    expect(suggestStart(teams as never, entries as never, "gypsum", "2026-12-01", 5, undefined, "gone")?.team.id).toBe("a");
  });
});

describe("G2 purchases from the quote's purchase list", () => {
  const line = (o: Partial<ListLine>): ListLine => ({ description: "x", colour: "", quantity: 4, unit: "pack", unit_price: 10, item: "new", product_id: null, general: true, ...o });
  it("subtracts what was already bought for the project (by stock item, else by catalogue product of a single pack size, never twice)", () => {
    const lines = [line({ description: "معجون", item: "i1", quantity: 10 }), line({ description: "دهان 18", product_id: "p1", quantity: 3 }), line({ description: "دهان 4", product_id: "p1", quantity: 2 }), line({ description: "برايمر", product_id: "p2", quantity: 3 }), line({ description: "شريط", quantity: 5 })];
    const bought = [
      { item_id: "i1", product_id: null, colour: null, unit: "pack", quantity: 4 },
      { item_id: "i9", product_id: "p1", colour: null, unit: "pack", quantity: 4 },
      { item_id: "i8", product_id: "p2", colour: null, unit: "pack", quantity: 4 },
    ];
    // two pack sizes of p1: a bought line can't tell which size it is → counted for neither (sizes never mix)
    expect(markBought(lines, bought).map((l) => [l.description, l.bought, l.remaining])).toEqual([
      ["معجون", 4, 6],
      ["دهان 18", 0, 3],
      ["دهان 4", 0, 2],
      ["برايمر", 3, 0],
      ["شريط", 0, 5],
    ]);
  });
  it("adds lines to what is there (AI-read lines stay); only a single blank row is replaced", () => {
    const blank = (r: { d: string }) => !r.d;
    expect(mergeRows([{ d: "" }], [{ d: "a" }], blank)).toEqual([{ d: "a" }]);
    expect(mergeRows([{ d: "من الفاتورة" }], [{ d: "a" }], blank)).toEqual([{ d: "من الفاتورة" }, { d: "a" }]);
    expect(mergeRows([{ d: "x" }, { d: "" }], [{ d: "a" }], blank)).toEqual([{ d: "x" }, { d: "a" }]);
  });
});

describe("G3 stock items linked to catalogue products", () => {
  it("a purchase line on an existing unlinked item links it to the line's product (once per item, never re-links)", () => {
    const items = [{ id: "i1", product_id: null }, { id: "i2", product_id: "p9" }, { id: "i3", product_id: null }];
    const lines = [
      { kind: "material" as const, item_id: "i1", product_id: "p1" },
      { kind: "material" as const, item_id: "i1", product_id: "p1" },
      { kind: "material" as const, item_id: "i2", product_id: "p1" },
      { kind: "material" as const, item_id: "i3", product_id: null },
      { kind: "expense" as const, item_id: null, product_id: "p2" },
    ];
    expect(itemsToLink(lines, items)).toEqual([{ id: "i1", product_id: "p1" }]);
  });
});

describe("#13 assistant links: only pages the asker can open, only numbers from the facts", () => {
  const facts = { projects: [{ contract: "C-2026-001" }], latePayments: [{ contract: "C-2026-002" }], pendingApprovals: [{ number: "Q-2026-010" }] };
  const links = ["/reports", "/purchases/costs", "/quotations/Q-2026-010", "/contracts/C-2026-001", "/projects/C-2026-002", "/projects/C-2026-999", "/invoices/INV-2026-001", "/team/payroll", "/maintenance", "/schedule", "/settings/qoyod"].map((href) => ({ label: href, href }));
  it("a finance user without costs/quotes/hr/projects sees only finance pages", () => {
    expect(assistantLinks(links, ["finance.view"], facts).map((l) => l.href)).toEqual(["/reports"]);
  });
  it("the owner sees every allowed page whose number is in the facts", () => {
    const all = ["finance.view", "costs.view", "quotes.view", "projects.view", "hr.view", "schedule.view", "purchases.view", "clients.view"];
    expect(assistantLinks(links, all, facts).map((l) => l.href)).toEqual(["/reports", "/purchases/costs", "/quotations/Q-2026-010", "/contracts/C-2026-001", "/projects/C-2026-002", "/team/payroll", "/maintenance", "/schedule"]);
  });
});
