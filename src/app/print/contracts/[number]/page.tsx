import { BrandStyle } from "@/components/brand-style";
import { ContractTerms } from "@/components/contracts/contract-terms";
import { PrintButton } from "@/components/quotes/print-button";
import { QuoteDocument } from "@/components/quotes/quote-document";
import { requirePermission } from "@/lib/auth/session";
import { loadContract } from "@/lib/data/contracts";
import { orgLogoUrl } from "@/lib/org";

/** Print-ready contract with its quote annex (server PDF via /api/pdf/contracts/…). */
export default async function PrintContractPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("quotes.view");
  const [detail, logoUrl] = await Promise.all([loadContract(session, decodeURIComponent(number)), orgLogoUrl(session.organization)]);
  const o = session.organization;
  const c = detail.contract;
  const org = { name: o.name, legal_name: o.legal_name, cr_number: o.cr_number, vat_number: o.vat_number, phone: o.phone, city: o.city, address: o.address, signatory_name: o.signatory_name, signatory_title: o.signatory_title };
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={o.brand.primary} accent={o.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton pdfHref={`/api/pdf/contracts/${encodeURIComponent(c.number)}`} />
      </div>
      <div className="mx-auto grid max-w-[820px] gap-8 px-4 print:px-0">
        <ContractTerms
          terms={detail.terms}
          org={org}
          client={detail.client}
          data={{
            number: c.number, date: c.created_at, quoteNumber: detail.quote.number, view: detail.quote.view ?? null, service: c.service, project_type: c.project_type, start_date: c.start_date, duration_days: c.duration_days,
            warranty_months: c.warranty_months, total: c.total, notes: c.notes, method: detail.quote.view?.method ?? "unit",
            payments: detail.payments, accepted: c.accepted_at ? { at: c.accepted_at, name: c.accepted_name ?? "" } : null,
          }}
        />
        {detail.quote.view && (
          <div className="break-before-page">
            <QuoteDocument
              org={{ ...org, logoUrl }}
              number={detail.quote.number}
              version={detail.quote.version}
              date={detail.quote.date}
              validUntil={detail.quote.valid_until}
              client={detail.client}
              view={detail.quote.view}
              notes={detail.quote.notes}
              warrantyMonths={c.warranty_months}
            />
          </div>
        )}
      </div>
    </main>
  );
}
