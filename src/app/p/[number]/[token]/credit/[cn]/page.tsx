import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { InvoiceDocument } from "@/components/finance/invoice-document";
import { PrintButton } from "@/components/quotes/print-button";
import { CREDIT_NOTE_RE } from "@/lib/credit-notes";
import { loadPortal } from "@/lib/portal";
import { invoiceQr } from "@/lib/qr";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Client page → one credit note (same token checks and rate limit as the page itself). */
export default async function PortalCreditNotePage({ params }: { params: Promise<{ number: string; token: string; cn: string }> }) {
  const { number, token, cn } = await params;
  const n = decodeURIComponent(number);
  const cnNumber = decodeURIComponent(cn);
  if (!CREDIT_NOTE_RE.test(cnNumber)) notFound();
  const { data, logoUrl } = await loadPortal(n, token);
  const doc = data?.creditNotes?.find((c) => c.number === cnNumber);
  if (!data || !doc) notFound();
  const inv = { ...doc, due_date: doc.issue_date, paid: 0 };
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={data.org.brand.primary} accent={data.org.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton pdfHref={`/p/${encodeURIComponent(n)}/${token}/pdf/${encodeURIComponent(cnNumber)}`} />
      </div>
      <InvoiceDocument data={inv} logoUrl={logoUrl} qr={await invoiceQr(inv)} credit={{ invoice: doc.invoice }} />
    </main>
  );
}
