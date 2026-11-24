import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { PrintButton } from "@/components/quotes/print-button";
import { QuoteDocument } from "@/components/quotes/quote-document";
import { loadPortal } from "@/lib/portal";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * Client page → the quotation (the option on his screen: ?v=<version>), ready to print or
 * download — same token checks as the page; only an issued (or answered) offer has a document.
 */
export default async function PortalQuotePage({ params, searchParams }: { params: Promise<{ number: string; token: string }>; searchParams: Promise<{ v?: string }> }) {
  const [{ number, token }, { v }] = await Promise.all([params, searchParams]);
  const n = decodeURIComponent(number);
  const { quoteStage, data, logoUrl } = await loadPortal(n, token);
  const org = quoteStage?.org ?? data?.org;
  if (!org) notFound();
  // the quote stage: its options or current version; the contract stage: the version in the contract
  const want = Number(v);
  const doc = quoteStage
    ? (() => {
        const opt = quoteStage.options.find((o) => o.version === want) ?? (quoteStage.options.length ? quoteStage.options[0] : null);
        if (opt) return { version: opt.version, date: opt.date, view: opt.client_view, notes: opt.notes };
        const q = quoteStage.quote;
        return q.client_view && q.version != null ? { version: q.version, date: q.date ?? "", view: q.client_view, notes: q.notes } : null;
      })()
    : data
      ? { version: data.quote.version, date: data.quote.date, view: data.quote.client_view, notes: data.quote.notes }
      : null;
  if (!doc) notFound();
  const quoteNumber = quoteStage?.quote.number ?? data!.quote.number;
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={org.brand.primary} accent={org.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton pdfHref={`/p/${encodeURIComponent(n)}/${token}/pdf/quote-${doc.version}`} />
      </div>
      <div className="mx-auto max-w-[820px] px-4 print:px-0">
        <QuoteDocument
          org={{ name: org.name, legal_name: org.legal_name, cr_number: org.cr_number, vat_number: org.vat_number, phone: org.phone, city: org.city, logoUrl }}
          number={quoteNumber}
          version={doc.version}
          date={doc.date}
          validUntil={quoteStage?.quote.valid_until ?? data?.quote.valid_until ?? null}
          client={(quoteStage ?? data)!.client}
          view={doc.view}
          notes={doc.notes}
          warrantyMonths={quoteStage?.quote.warranty_months ?? data?.contract.warranty_months ?? 6}
        />
      </div>
    </main>
  );
}
