import { BrandStyle } from "@/components/brand-style";
import { InvoiceDocument } from "@/components/finance/invoice-document";
import { PrintButton } from "@/components/quotes/print-button";
import { requirePermission } from "@/lib/auth/session";
import { asInvoiceDoc, loadCreditNote } from "@/lib/data/credit-notes";
import { orgLogoUrl } from "@/lib/org";
import { invoiceQr } from "@/lib/qr";

/** Print-ready credit note (إشعار دائن) — finance.view like invoices. */
export default async function PrintCreditNotePage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("finance.view");
  const o = session.organization;
  const [cn, logoUrl] = await Promise.all([loadCreditNote(session, decodeURIComponent(number)), orgLogoUrl(o)]);
  const doc = asInvoiceDoc(cn);
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={o.brand.primary} accent={o.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton pdfHref={`/api/pdf/credit-notes/${encodeURIComponent(cn.number)}`} />
      </div>
      <InvoiceDocument data={doc} logoUrl={logoUrl} qr={await invoiceQr(doc)} credit={{ invoice: cn.invoice }} />
    </main>
  );
}
