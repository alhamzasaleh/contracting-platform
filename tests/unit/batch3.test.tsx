import { describe, expect, it, vi } from "vitest";
import { render } from "./helpers/render";
import { paymentRecordError } from "@/lib/finance";
import { signOutEndpoint } from "@/lib/notifications/endpoint";
import { subWorkError, workRemaining } from "@/lib/subcontractors";
import { WarrantySection } from "@/components/portal/warranty-section";
import { MaintenanceView } from "@/components/projects/maintenance-view";
import type { PortalWarranty } from "@/lib/portal";
import type { MaintenancePageData } from "@/lib/data/maintenance";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

/** Review batch 3 (Nov 2026). */

describe("#18 recording more than a payment's amount", () => {
  it("maps the database refusals to clear messages", () => {
    expect(paymentRecordError("more than the amount due")).toBe("paymentOverDue");
    expect(paymentRecordError("already paid")).toBe("paymentAlreadyPaid");
    expect(paymentRecordError("the contract isn't accepted")).toBe("paymentNotAccepted");
    expect(paymentRecordError("the addendum isn't accepted")).toBe("paymentNotAccepted");
    expect(paymentRecordError("something else")).toBeNull();
    expect(paymentRecordError(undefined)).toBeNull();
  });
});

describe("#20 subcontractor work within the agreement", () => {
  it("what is left to record: area for per m², share for lump sum", () => {
    expect(workRemaining({ basis: "per_m2", rate: 20, quantity_m2: 100 }, [{ quantity_m2: 70, percent: null }])).toBe(30);
    expect(workRemaining({ basis: "lump", rate: 9000, quantity_m2: null }, [{ quantity_m2: null, percent: 60 }, { quantity_m2: null, percent: 25 }])).toBe(15);
    expect(workRemaining({ basis: "per_m2", rate: 20, quantity_m2: 50 }, [{ quantity_m2: 60, percent: null }])).toBe(0);
  });
  it("maps the database refusals to clear messages", () => {
    expect(subWorkError("more than the agreement (area)")).toBe("subWorkOver");
    expect(subWorkError("more than the agreement (share)")).toBe("subWorkOver");
    expect(subWorkError("the agreement is closed")).toBe("agreementClosed");
    expect(subWorkError("other")).toBeNull();
  });
});

describe("#21 sign-out removes this device's push subscription", () => {
  it("reads the endpoint the app sends (JSON), ignores anything else", () => {
    const ep = "https://web.push.apple.com/QOS-" + "a".repeat(30);
    expect(signOutEndpoint({ endpoint: ep })).toBe(ep);
    expect(signOutEndpoint({ endpoint: "https://evil.example/x" })).toBeNull();
    expect(signOutEndpoint({ endpoint: ep, extra: 1 })).toBeNull();
    expect(signOutEndpoint(null)).toBeNull();
    expect(signOutEndpoint("x")).toBeNull();
  });
});

describe("#23 maintenance closed by staff or the client", () => {
  const base = { id: "m1", number: "MR-2026-004", body: "شق", photos: [], reply: null, created_at: "2026-11-20T09:00:00Z", resolved_at: null };
  it("the client page says the company closed it (and when)", () => {
    const w: PortalWarranty = {
      handover_at: "2026-11-01T09:00:00Z", warranty_end: "2027-05-01", active: true,
      requests: [{ ...base, status: "closed", client_confirmed_at: null, closed_at: "2026-11-22T09:00:00Z", closed_by_staff: true }],
    };
    const html = render(<WarrantySection w={w} number="C-2026-001" token="t" />);
    expect(html).toContain("أغلقها فريق الشركة");
    expect(html).toContain("22 نوفمبر 2026");
  });
  it("closed by the client still reads as the client's confirmation", () => {
    const w: PortalWarranty = {
      handover_at: "2026-11-01T09:00:00Z", warranty_end: "2027-05-01", active: true,
      requests: [{ ...base, status: "closed", client_confirmed_at: "2026-11-22T09:00:00Z", closed_at: "2026-11-22T09:00:00Z", closed_by_staff: false }],
    };
    const html = render(<WarrantySection w={w} number="C-2026-001" token="t" />);
    expect(html).not.toContain("أغلقها فريق الشركة");
  });
  it("the staff page names who closed it", () => {
    const data: MaintenancePageData = {
      requests: [{
        ...base, contract: "C-2026-001", client: "أبو فهد", client_phone: null, source: "client", status: "closed", assigned_to: null, covered: true, cost: 0,
        internal_note: null, client_confirmed_at: null, closed_at: "2026-11-22T09:00:00Z", closed_by: "u2",
      }],
      warranties: [], members: [{ id: "u2", name: "سالم" }], canManage: true,
    };
    const html = render(<MaintenanceView data={data} focus="MR-2026-004" />);
    expect(html).toContain("أغلقه سالم");
  });
});
