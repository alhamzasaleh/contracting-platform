import { describe, expect, it, vi } from "vitest";
import { hrefs, render } from "./helpers/render";
import { lastValidDay } from "@/lib/contracts";
import { projectBought, purchaseCharge } from "@/lib/purchases";
import { findJournalEntry, pettyOpeningBody, pettyOpeningTag, pettyPlan } from "@/lib/qoyod/payloads";
import { OwnerFinanceSections } from "@/components/finance/owner-dashboard";
import { PortalView } from "@/components/portal/portal-view";
import { ProjectCostsView, PurchasesList, PurchaseView } from "@/components/purchases/purchase-views";
import { SAMPLE_PORTAL } from "@/app/dev/preview/sample-contracts";
import { SAMPLE_FINANCE } from "@/app/dev/preview/sample-finance";
import { SAMPLE_COSTS, SAMPLE_PURCHASE_DETAIL, SAMPLE_PURCHASES } from "@/app/dev/preview/sample-purchases";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

/** Review of batch 2, third round (Nov 2026). */

const riyadhDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });

describe("#1 the client page is valid until the last day of the warranty", () => {
  it("expires_at is Riyadh midnight after the last day: the shown day is the day before", () => {
    // warranty ends 2027-06-01 → the link expires 2027-06-02 00:00 Riyadh (= 2027-06-01T21:00Z)
    expect(riyadhDay(lastValidDay("2027-06-01T21:00:00Z"))).toBe("2027-06-01");
    expect(riyadhDay(lastValidDay("2027-06-01T21:00:00.000Z"))).toBe("2027-06-01");
    // an expiry inside a day still shows that day
    expect(riyadhDay(lastValidDay("2027-06-01T12:00:00Z"))).toBe("2027-06-01");
  });
  it("the client page footer shows the last valid day", () => {
    const html = render(<PortalView data={{ ...SAMPLE_PORTAL, expires_at: "2027-07-09T21:00:00Z" }} logoUrl={null} number="C-2026-004" token="preview" />);
    expect(html).toContain("صالحة حتى 9 يوليو 2027");
    expect(html).not.toContain("صالحة حتى 10 يوليو 2027");
  });
});

describe("#2 links follow the viewer's permissions", () => {
  const projects = new Map([["k0", { number: "C-2026-003", client: "شركة" }]]);
  it("purchaseCharge: stock, a project the viewer can't see, a contract or a project link", () => {
    expect(purchaseCharge(null, projects, { contracts: true, projects: true })).toEqual({ kind: "stock" });
    expect(purchaseCharge("k9", projects, { contracts: true, projects: true })).toEqual({ kind: "hidden" });
    expect(purchaseCharge("k0", projects, { contracts: true, projects: true })).toEqual({ kind: "project", number: "C-2026-003", client: "شركة", href: "/contracts/C-2026-003" });
    expect(purchaseCharge("k0", projects, { contracts: false, projects: true })).toMatchObject({ href: "/projects/C-2026-003" });
    expect(purchaseCharge("k0", projects, { contracts: false, projects: false })).toMatchObject({ kind: "project", href: null });
  });
  it("a project purchase is never shown as general stock (list and detail)", () => {
    const list = render(<PurchasesList purchases={[{ ...SAMPLE_PURCHASES[0], charge: { kind: "hidden" } }]} canManage={false} />);
    expect(list).not.toContain("المخزون العام");
    const detail = render(<PurchaseView detail={{ ...SAMPLE_PURCHASE_DETAIL.purchase, charge: { kind: "hidden" } }} items={SAMPLE_PURCHASE_DETAIL.items} />);
    expect(detail).not.toContain("المخزون العام");
  });
  it("the purchase detail links the project page with projects.view only, plain text without either", () => {
    const viaProject = render(<PurchaseView detail={{ ...SAMPLE_PURCHASE_DETAIL.purchase, charge: { kind: "project", number: "C-2026-003", client: "شركة", href: "/projects/C-2026-003" } }} items={SAMPLE_PURCHASE_DETAIL.items} />);
    expect(hrefs(viaProject)).toContain("/projects/C-2026-003");
    expect(hrefs(viaProject).some((h) => h.startsWith("/contracts/"))).toBe(false);
    const plain = render(<PurchaseView detail={{ ...SAMPLE_PURCHASE_DETAIL.purchase, charge: { kind: "project", number: "C-2026-003", client: "شركة", href: null } }} items={SAMPLE_PURCHASE_DETAIL.items} />);
    expect(plain).toContain("C-2026-003");
    expect(hrefs(plain).some((h) => /\/(contracts|projects)\//.test(h))).toBe(false);
  });
  it("project costs rows link like everywhere else (contract → project → plain)", () => {
    const asProject = hrefs(render(<ProjectCostsView rows={SAMPLE_COSTS} links={{ contracts: false, projects: true }} />));
    expect(asProject).toContain(`/projects/${SAMPLE_COSTS[0].number}`);
    expect(asProject.some((h) => h.startsWith("/contracts/"))).toBe(false);
    const none = hrefs(render(<ProjectCostsView rows={SAMPLE_COSTS} links={{ contracts: false, projects: false }} />));
    expect(none.some((h) => /\/(contracts|projects)\//.test(h))).toBe(false);
    expect(hrefs(render(<ProjectCostsView rows={SAMPLE_COSTS} links={{ contracts: true, projects: true }} />))).toContain(`/contracts/${SAMPLE_COSTS[0].number}`);
  });
  it("home: the active-projects card needs projects.view, the team-cost title schedule.view", () => {
    const all = hrefs(render(<OwnerFinanceSections f={SAMPLE_FINANCE} />));
    expect(all).toContain("/projects");
    expect(all).toContain("/schedule");
    const none = hrefs(render(<OwnerFinanceSections f={{ ...SAMPLE_FINANCE, links: { ...SAMPLE_FINANCE.links, projects: false, schedule: false } }} />));
    expect(none).not.toContain("/projects");
    expect(none).not.toContain("/schedule");
  });
});

describe("#3 Qoyod journal lookup: 404 = not found", () => {
  it("a 404 is null; network errors, 5xx and 401 still throw", async () => {
    const fail = (status: number) => async () => Promise.reject(Object.assign(new Error(`HTTP ${status}`), { status }));
    expect(await findJournalEntry(fail(404), "[PETTY-x]")).toBeNull();
    await expect(findJournalEntry(fail(500), "[PETTY-x]")).rejects.toThrow("HTTP 500");
    await expect(findJournalEntry(fail(401), "[PETTY-x]")).rejects.toThrow("HTTP 401");
    await expect(findJournalEntry(async () => Promise.reject(new Error("network")), "[PETTY-x]")).rejects.toThrow("network");
  });
});

describe("#4 petty cash opening transfer when a cash account is chosen later", () => {
  it("bank → cash for the open balance, tagged with the job so a retry finds it", () => {
    expect(pettyOpeningTag("j-1")).toBe("[PETTY-OPEN-j-1]");
    const b = pettyOpeningBody({ jobId: "j-1", date: "2026-11-24", amount: 715.004, bankAccountId: 8, cashAccountId: 7 });
    expect(b.journal_entry.description.startsWith("[PETTY-OPEN-j-1]")).toBe(true);
    expect(b.journal_entry.date).toBe("2026-11-24");
    expect(b.journal_entry.debit_amounts).toEqual([{ account_id: 7, amount: 715, comment: expect.any(String) }]);
    expect(b.journal_entry.credit_amounts).toEqual([{ account_id: 8, amount: 715, comment: expect.any(String) }]);
  });
});

describe("#4 petty cash posts by the route fixed when its job was queued", () => {
  const noCash = { receive_account_id: 8, cash_account_id: null };
  const cash = { receive_account_id: 8, cash_account_id: 7 };
  it("route 'bank' stays bank even after a cash account is chosen (top-up/return = no-op, expense paid from the bank)", () => {
    expect(pettyPlan("bank", noCash)).toEqual({ post: "bank" });
    expect(pettyPlan("bank", cash)).toEqual({ post: "bank" });
  });
  it("route 'cash' uses the cash account; if it was cleared (or is now the bank), waits instead of switching", () => {
    expect(pettyPlan("cash", cash)).toEqual({ post: "cash", cashAccountId: 7 });
    expect(pettyPlan("cash", noCash)).toEqual({ wait: "cash_account" });
    expect(pettyPlan("cash", { receive_account_id: 8, cash_account_id: 8 })).toEqual({ wait: "cash_account" });
  });
  it("a job without a route (older rows) follows the current settings", () => {
    expect(pettyPlan(null, noCash)).toEqual({ post: "bank" });
    expect(pettyPlan(null, { receive_account_id: 8, cash_account_id: 8 })).toEqual({ post: "bank" });
    expect(pettyPlan(null, cash)).toEqual({ post: "cash", cashAccountId: 7 });
  });
});

describe("#6 a movement without colour is shared between the item's colours", () => {
  const items = [{ id: "i1", unit: "pack", product_id: "p1" }, { id: "i2", unit: "pack", product_id: "p2" }];
  const qty = (rows: ReturnType<typeof projectBought>) => Object.fromEntries(rows.map((r) => [`${r.item_id}|${r.colour}`, r.quantity]));
  it("white 10 + beige 10, then 4 out → 8 / 8", () => {
    const moves = [{ item_id: "i1", quantity: 10, colour: "أبيض" }, { item_id: "i1", quantity: 10, colour: "بيج" }, { item_id: "i1", quantity: -4, colour: null }];
    expect(qty(projectBought(moves, [], items))).toEqual({ "i1|أبيض": 8, "i1|بيج": 8 });
  });
  it("in proportion to the positive balances (white 15 + beige 5, 4 out → 12 / 4)", () => {
    const moves = [{ item_id: "i1", quantity: 15, colour: "أبيض" }, { item_id: "i1", quantity: 5, colour: "بيج" }, { item_id: "i1", quantity: -4, colour: null }];
    expect(qty(projectBought(moves, [], items))).toEqual({ "i1|أبيض": 12, "i1|بيج": 4 });
  });
  it("an issue of 5 into a white-only item → white + 5", () => {
    const moves = [{ item_id: "i1", quantity: 3, colour: "أبيض" }, { item_id: "i1", quantity: 5, colour: null }];
    expect(qty(projectBought(moves, [], items))).toEqual({ "i1|أبيض": 8 });
  });
  it("no colours at all → no colour; never dropped", () => {
    expect(qty(projectBought([{ item_id: "i2", quantity: 6, colour: null }, { item_id: "i2", quantity: -1, colour: null }], [], items))).toEqual({ "i2|": 5 });
  });
  it("an issue into an item whose colours are all used up is shared equally, not lost", () => {
    const moves = [{ item_id: "i1", quantity: 2, colour: "أبيض" }, { item_id: "i1", quantity: -2, colour: "أبيض" }, { item_id: "i1", quantity: 2, colour: "بيج" }, { item_id: "i1", quantity: -2, colour: "بيج" }, { item_id: "i1", quantity: 4, colour: null }];
    expect(qty(projectBought(moves, [], items))).toEqual({ "i1|أبيض": 2, "i1|بيج": 2 });
  });
});
