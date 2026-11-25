import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render } from "./helpers/render";
import { autoSetupDue, autoSetupNext, NEEDS_APPROVED_KINDS, waitsForApproved } from "@/lib/qoyod/payloads";
import { QoyodSettingsView } from "@/components/settings/qoyod-view";
import type { QoyodPageData } from "@/lib/data/qoyod";
import type { QoyodOptions } from "@/lib/qoyod/client";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/settings/qoyod/actions", () => ({}));

/** Qoyod petty-cash reconciliation, fourth review (Nov 2026). */

describe("#4 the owner's choice of optional accounts sticks", () => {
  const required = { inventory_id: 1, receive_account_id: 2, expense_account_id: 3, addendum_product_id: 7, service_products: { gypsum: 1, interior: 2, exterior: 3 } };
  const auto = { inventory_id: 11, receive_account_id: 12, expense_account_id: 13, salary_account_id: 14, cash_account_id: 15, subcontract_account_id: 16, service_products: { gypsum: 21, interior: 22, exterior: 23 }, addendum_product_id: 24 };

  it("first setup (never run): due, and the optional accounts are picked", () => {
    const cur = { ...required, salary_account_id: null, cash_account_id: null, subcontract_account_id: null, auto_setup_at: null };
    expect(autoSetupDue(cur)).toBe(true);
    expect(autoSetupNext(cur, auto)).toMatchObject({ salary_account_id: 14, cash_account_id: 15, subcontract_account_id: 16, receive_account_id: 2 });
    // nothing set yet at all (first connect)
    expect(autoSetupNext(null, auto)).toMatchObject({ inventory_id: 11, receive_account_id: 12, cash_account_id: 15 });
  });

  it("after the first setup an optional account the owner cleared is never picked again (no daily re-pick)", () => {
    const cleared = { ...required, salary_account_id: null, cash_account_id: null, subcontract_account_id: null, auto_setup_at: "2026-11-01T09:00:00Z", commission_setup_at: "2026-11-01T09:00:00Z" };
    expect(autoSetupDue(cleared)).toBe(false);
    expect(autoSetupDue({ ...cleared, auto_setup_at: "2026-01-01T00:00:00Z" })).toBe(false);
    // even when a required setting is missing and the setup runs, the cleared ones stay empty
    const missing = { ...cleared, inventory_id: null };
    expect(autoSetupDue(missing)).toBe(true);
    expect(autoSetupNext(missing, auto)).toMatchObject({ inventory_id: 11, salary_account_id: null, cash_account_id: null, subcontract_account_id: null });
  });

  it("the owner's own choices are kept; the cash account is never the bank account", () => {
    const cur = { ...required, salary_account_id: 40, cash_account_id: null, subcontract_account_id: 41, auto_setup_at: null };
    expect(autoSetupNext(cur, auto)).toMatchObject({ salary_account_id: 40, cash_account_id: 15, subcontract_account_id: 41 });
    expect(autoSetupNext({ ...cur, receive_account_id: 15 }, auto).cash_account_id).toBeNull();
    expect(autoSetupNext({ ...cur, service_products: { gypsum: 9 } }, auto).service_products).toEqual({ gypsum: 9, interior: 22, exterior: 23 });
  });
});

describe("#5 jobs that wait for Approved: the worker doesn't claim them while sending is Draft", () => {
  it("the database's claim list is the same as NEEDS_APPROVED", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20270102000001_review_batch2.sql"), "utf8");
    const fn = sql.slice(sql.lastIndexOf("create or replace function public.qoyod_claim_jobs"));
    const list = fn.match(/q\.kind not in \(([^)]*)\)/)?.[1];
    expect(list?.split(",").map((x) => x.trim().replace(/'/g, "")).sort()).toEqual([...NEEDS_APPROVED_KINDS].sort());
    for (const k of NEEDS_APPROVED_KINDS) expect(waitsForApproved(k, "Draft")).toBe(true);
    expect(waitsForApproved("bill", "Draft")).toBe(false);
  });
});

describe("#6 the job log shows each reconcile's direction and why one was skipped", () => {
  const options: QoyodOptions = {
    inventories: [{ id: 1, name: "المستودع" }],
    accounts: [
      { id: 7, code: "110101", name: "النقدية في الخزينة", receive: true, type: "Asset" },
      { id: 8, code: "110102", name: "البنك الأهلي", receive: true, type: "Asset" },
      { id: 9, code: "110103", name: "صندوق الموقع", receive: true, type: "Asset" },
    ],
    products: [],
  };
  const job = (j: Partial<QoyodPageData["jobs"][number]>): QoyodPageData["jobs"][number] => ({
    id: "j", kind: "transfer", status: "queued", attempts: 0, last_error: null, qoyod_id: null, amount: 715, created_at: "2026-11-24T08:00:00Z", done_at: null, label: "—", opening: true, from_account_id: null, to_account_id: 7, ...j,
  });
  const data = (jobs: QoyodPageData["jobs"], invoice_status: "Draft" | "Approved" = "Approved"): QoyodPageData => ({
    settings: {
      enabled: true, invoice_status, inventory_id: 1, receive_account_id: 8, expense_account_id: 52, service_products: {}, salary_account_id: null, cash_account_id: 7,
      subcontract_account_id: null, addendum_product_id: null, key_last4: "7Q2X", key_set_at: "2026-11-01T00:00:00Z", sync_from: null,
    },
    counts: { queued: 1, done: 0, failed: 0 }, canManage: true, canRetry: true, jobs,
  });

  it("names both accounts (null = the bank account)", () => {
    const html = render(<QoyodSettingsView preview data={data([job({ id: "a" }), job({ id: "b", from_account_id: 7, to_account_id: 9 })])} sampleOptions={options} />);
    expect(html).toContain("البنك الأهلي ← النقدية في الخزينة");
    expect(html).toContain("النقدية في الخزينة ← صندوق الموقع");
  });

  it("a reconcile whose two accounts became the same has its own reason, in both languages", () => {
    const html = render(<QoyodSettingsView preview data={data([job({ status: "done", last_error: "skipped:same_account_reconcile" })])} sampleOptions={options} />);
    expect(html).toContain(ar.qoyod.skipped_same_account_reconcile);
    expect(ar.qoyod.skipped_same_account_reconcile).not.toBe(ar.qoyod.skipped_same_account);
    expect(en.qoyod.skipped_same_account_reconcile).toBeTruthy();
    expect(en.qoyod.reconcileDirection).toContain("→");
  });

  it("an unclaimed job that waits for Approved says so while sending is Draft", () => {
    const html = render(<QoyodSettingsView preview data={data([job({})], "Draft")} sampleOptions={options} />);
    expect(html).toContain(ar.qoyod.waiting_approved);
  });
});
