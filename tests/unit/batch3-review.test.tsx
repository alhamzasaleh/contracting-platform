import { describe, expect, it, vi } from "vitest";
import { render } from "./helpers/render";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import { paymentRecordError } from "@/lib/finance";
import { scheduleSaveError } from "@/lib/contracts";
import { claimDevice, enableDevice } from "@/lib/client/push-device";
import { WarrantySection } from "@/components/portal/warranty-section";
import { MaintenanceView } from "@/components/projects/maintenance-view";
import type { PortalWarranty } from "@/lib/portal";
import type { MaintenancePageData } from "@/lib/data/maintenance";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

/** Review of batch 3 (Nov 2026). */

describe("#3 saving a contract: the database refusal decides the message", () => {
  it("locked → contractLocked, only the 100 % rule → paymentsSum, other 22023 → generic invalid schedule", () => {
    expect(scheduleSaveError({ code: "42501", message: "the contract is locked (accepted or cancelled)" })).toBe("contractLocked");
    expect(scheduleSaveError({ code: "22023", message: "invalid payment schedule: percentages must total 100 (99.98)" })).toBe("paymentsSum");
    expect(scheduleSaveError({ code: "22023", message: "invalid payment schedule" })).toBe("scheduleInvalid");
    expect(scheduleSaveError({ code: "22023", message: "quote not issued" })).toBe("quoteNotIssued");
    expect(scheduleSaveError({ code: "22023", message: "a contract needs an issued quote" })).toBe("quoteNotIssued");
    expect(scheduleSaveError({ code: "22023", message: "waiting for the owner's approval" })).toBe("needsApproval");
    expect(scheduleSaveError({ code: "23505", message: "duplicate key" })).toBeNull();
    expect(scheduleSaveError({ code: "42501", message: "not allowed" })).toBeNull();
    expect(scheduleSaveError(null)).toBeNull();
  });
  it("every message exists in both languages", () => {
    for (const k of ["scheduleInvalid", "addendumNotAccepted", "noPaymentSchedule"]) {
      expect((ar.errors as Record<string, string>)[k], k).toBeTruthy();
      expect((en.errors as Record<string, string>)[k], k).toBeTruthy();
    }
  });
});

describe("#4 recording an addendum payment before acceptance", () => {
  it("says the addendum (not the contract) isn't accepted", () => {
    expect(paymentRecordError("the addendum isn't accepted")).toBe("addendumNotAccepted");
    expect(paymentRecordError("the contract isn't accepted")).toBe("paymentNotAccepted");
  });
});

describe("#2 maintenance closed or rejected by staff", () => {
  const base = { id: "m1", number: "MR-2026-004", body: "شق", photos: [], created_at: "2026-11-20T09:00:00Z", resolved_at: null };
  const item = (over: Partial<MaintenancePageData["requests"][number]>): MaintenancePageData => ({
    requests: [{
      ...base, reply: "تم الكشف: التشقق من حركة المبنى", contract: "C-2026-001", client: "أبو فهد", client_phone: "966511112222", source: "client", status: "closed",
      assigned_to: null, covered: true, cost: 0, internal_note: null, client_confirmed_at: null, closed_at: "2026-11-22T09:00:00Z", closed_by: "u2", ...over,
    }],
    warranties: [], members: [{ id: "u2", name: "سالم" }], canManage: true, orgName: "ملمس",
  });
  const waText = (html: string) => {
    const m = html.match(/href="https:\/\/wa\.me\/[^"?]*\?text=([^"]*)"/);
    return m ? decodeURIComponent(m[1].replace(/&amp;/g, "&")) : null;
  };

  it("staff page: «أغلقه / رفضه {name}», based on closed_by", () => {
    expect(render(<MaintenanceView data={item({})} focus="MR-2026-004" />)).toContain("أغلقه سالم");
    expect(render(<MaintenanceView data={item({ status: "rejected" })} focus="MR-2026-004" />)).toContain("رفضه سالم");
    const byClient = render(<MaintenanceView data={item({ closed_by: null, client_confirmed_at: "2026-11-22T09:00:00Z" })} focus="MR-2026-004" />);
    expect(byClient).not.toContain("أغلقه");
  });

  it("WhatsApp to the client with the staff reply: closed by staff, and rejected", () => {
    const closed = waText(render(<MaintenanceView data={item({})} focus="MR-2026-004" />));
    expect(closed).toContain("MR-2026-004");
    expect(closed).toContain("تم الكشف: التشقق من حركة المبنى");
    const rejected = waText(render(<MaintenanceView data={item({ status: "rejected" })} focus="MR-2026-004" />));
    expect(rejected).toContain("تم الكشف: التشقق من حركة المبنى");
    expect(rejected).not.toEqual(closed);
    // closed by the client himself: nothing to tell him
    expect(waText(render(<MaintenanceView data={item({ closed_by: null, client_confirmed_at: "2026-11-22T09:00:00Z" })} focus="MR-2026-004" />))).toBeNull();
  });

  it("WhatsApp texts exist in both languages and carry the reply", () => {
    for (const m of [ar, en]) {
      expect(m.wa.maintenanceClosed).toContain("{reply}");
      expect(m.wa.maintenanceRejected).toContain("{reply}");
      expect(m.wa.maintenanceReply).toContain("{reply}");
      expect(m.maintenance.rejectedBy).toContain("{name}");
      expect(m.warranty.rejectedByStaff).toContain("{date}");
    }
  });

  it("client page: rejected by the company says so (and when)", () => {
    const w: PortalWarranty = {
      handover_at: "2026-11-01T09:00:00Z", warranty_end: "2027-05-01", active: true,
      requests: [{ ...base, reply: null, status: "rejected", client_confirmed_at: null, closed_at: "2026-11-22T09:00:00Z", closed_by_staff: true }],
    };
    const html = render(<WarrantySection w={w} number="C-2026-001" token="t" />);
    expect(html).toContain("رفضها فريق الشركة");
    expect(html).toContain("22 نوفمبر 2026");
  });
});

describe("#5 notifications on this device: claim before showing «on»", () => {
  const sub = (endpoint = "https://web.push.apple.com/QOS-abc") => {
    const unsubscribe = vi.fn(async () => true);
    return { endpoint, unsubscribe, toJSON: () => ({ endpoint, keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } }) };
  };

  it("an existing browser subscription is claimed for the signed-in user before «on»", async () => {
    const s = sub();
    const save = vi.fn(async () => ({ ok: true }));
    expect(await claimDevice(s, save, "iPad")).toBe("on");
    expect(save).toHaveBeenCalledWith({ endpoint: s.endpoint, keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) }, device: "iPad" });
  });

  it("a failed claim shows «off» and never unsubscribes the browser (it may be someone else's)", async () => {
    const s = sub();
    expect(await claimDevice(s, async () => ({ ok: false }), "iPad")).toBe("off");
    expect(s.unsubscribe).not.toHaveBeenCalled();
    expect(await claimDevice(null, async () => ({ ok: true }), "iPad")).toBe("off");
  });

  it("enabling: unsubscribes only a subscription it just created, when saving fails", async () => {
    const existing = sub();
    const r1 = await enableDevice({ existing, subscribe: async () => sub("https://x/new"), save: async () => ({ ok: false }), device: "iPad" });
    expect(r1).toBe(false);
    expect(existing.unsubscribe).not.toHaveBeenCalled();
    const fresh = sub("https://fcm.googleapis.com/fcm/send/new");
    const r2 = await enableDevice({ existing: null, subscribe: async () => fresh, save: async () => ({ ok: false }), device: "iPad" });
    expect(r2).toBe(false);
    expect(fresh.unsubscribe).toHaveBeenCalled();
    expect(await enableDevice({ existing: null, subscribe: async () => sub(), save: async () => ({ ok: true }), device: "iPad" })).toBe(true);
  });
});
