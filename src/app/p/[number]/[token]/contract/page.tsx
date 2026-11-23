import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { ContractTerms } from "@/components/contracts/contract-terms";
import { PrintButton } from "@/components/quotes/print-button";
import { QuoteDocument } from "@/components/quotes/quote-document";
import { loadPortal } from "@/lib/portal";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Client page → the contract with its quote annex, ready to print or download (same token checks as the page). */
export default async function PortalContractPage({ params }: { params: Promise<{ number: string; token: string }> }) {
  const { number, token } = await params;
  const n = decodeURIComponent(number);
  const { data, logoUrl } = await loadPortal(n, token);
  if (!data) notFound();
  const { contract: c, org } = data;
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={org.brand.primary} accent={org.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton pdfHref={`/p/${encodeURIComponent(n)}/${token}/pdf/contract`} />
      </div>
      <div className="mx-auto grid max-w-[820px] gap-8 px-4 print:px-0">
        <ContractTerms
          terms={data.terms}
          org={org}
          client={data.client}
          data={{
            number: c.number, date: c.created_at ?? data.quote.date, quoteNumber: data.quote.number, view: data.quote.client_view ?? null, service: c.service, project_type: c.project_type, start_date: c.start_date, duration_days: c.duration_days,
            warranty_months: c.warranty_months, total: c.total, notes: c.notes, method: data.quote.client_view?.method ?? "unit",
            payments: data.payments, accepted: c.accepted_at ? { at: c.accepted_at, name: c.accepted_name ?? "" } : null,
          }}
        />
        <div className="break-before-page">
          <QuoteDocument
            org={{ name: org.name, legal_name: org.legal_name, cr_number: org.cr_number, vat_number: org.vat_number, phone: org.phone, city: org.city, logoUrl }}
            number={data.quote.number}
            version={data.quote.version}
            date={data.quote.date}
            validUntil={data.quote.valid_until}
            client={data.client}
            view={data.quote.client_view}
            notes={data.quote.notes}
            warrantyMonths={c.warranty_months}
          />
        </div>
      </div>
    </main>
  );
}
