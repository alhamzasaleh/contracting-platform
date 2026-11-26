import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/" }));
import { ContractTerms } from "@/components/contracts/contract-terms";
import { render } from "./helpers/render";

/**
 * The contract says where the project is (review, Nov 2026): a survey at a second villa → the
 * contract names that villa's district, not the client's house; without one, the client's.
 */
const data = {
  number: "C-2026-001", date: "2026-11-20", service: "gypsum" as const, project_type: "full" as const, start_date: "2026-12-01",
  duration_days: 10, warranty_months: 6, total: 1000, notes: null, method: "unit" as const, quoteNumber: "Q-2026-001", view: null, payments: [],
};
const org = { name: "ملمس", legal_name: null, cr_number: null, vat_number: null, phone: null, city: "الرياض" };

describe("the contract's project location", () => {
  it("is the survey's place when it has one", () => {
    const html = render(<ContractTerms data={data} org={org} client={{ name: "عبدالله", phone: null, city: "الرياض", district: "العليا", site_city: "الرياض", site_district: "الملقا" }} />);
    expect(html).toContain("موقع المشروع: الرياض — الملقا");
    expect(html).not.toContain("موقع المشروع: الرياض — العليا");
  });
  it("is the client's when the survey is at his site", () => {
    const html = render(<ContractTerms data={data} org={org} client={{ name: "عبدالله", phone: null, city: "الرياض", district: "العليا" }} />);
    expect(html).toContain("موقع المشروع: الرياض — العليا");
  });
});

describe("a survey site without names", () => {
  it("shows no place rather than the client's house", () => {
    const html = render(<ContractTerms data={data} org={org} client={{ name: "عبدالله", phone: null, city: "الرياض", district: "العليا", site_own: true, site_city: null, site_district: null }} />);
    expect(html).not.toContain("موقع المشروع:");
  });
});

describe("the quote names the project's site", () => {
  it("when its survey has its own site; not when at the client's", async () => {
    const { QuoteDocument } = await import("@/components/quotes/quote-document");
    const { SAMPLE_QUOTE } = await import("@/app/dev/preview/sample-quotes");
    const props = { org: { name: "ملمس" } as never, number: "Q-2026-008", version: 2, date: "2026-11-22", validUntil: null, view: SAMPLE_QUOTE.current!.clientView, notes: null, warrantyMonths: 6 };
    expect(render(<QuoteDocument {...props} client={{ name: "ع", phone: null, city: "الرياض", site_own: true, site_city: "الرياض", site_district: "النرجس" }} />)).toContain("موقع المشروع: الرياض — النرجس");
    expect(render(<QuoteDocument {...props} client={{ name: "ع", phone: null, city: "الرياض" }} />)).not.toContain("موقع المشروع:");
  });
});
