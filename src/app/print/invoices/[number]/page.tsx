import { BrandStyle } from "@/components/brand-style";
import { InvoiceDocument } from "@/components/finance/invoice-document";
import { PrintButton } from "@/components/quotes/print-button";
import { requirePermission } from "@/lib/auth/session";
import { loadInvoice } from "@/lib/data/invoices";
import { orgLogoUrl } from "@/lib/org";

/** Print-ready invoice (Share → Print → Save as PDF). */
export default async function PrintInvoicePage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("finance.view");
  const o = session.organization;
  const [inv, logoUrl] = await Promise.all([loadInvoice(session, decodeURIComponent(number)), orgLogoUrl(o)]);
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={o.brand.primary} accent={o.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      <InvoiceDocument data={inv} logoUrl={logoUrl} />
    </main>
  );
}
