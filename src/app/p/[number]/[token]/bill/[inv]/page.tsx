import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { InvoiceDocument } from "@/components/finance/invoice-document";
import { PrintButton } from "@/components/quotes/print-button";
import { loadPortal } from "@/lib/portal";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Client page → one invoice (same token checks and rate limit as the page itself). */
export default async function PortalInvoicePage({ params }: { params: Promise<{ number: string; token: string; inv: string }> }) {
  const { number, token, inv } = await params;
  const n = decodeURIComponent(number);
  const invNumber = decodeURIComponent(inv);
  if (!/^INV-\d{4}-\d{3,6}$/.test(invNumber)) notFound();
  const { data, logoUrl } = await loadPortal(n, token);
  const doc = data?.invoiceDocs?.find((i) => i.number === invNumber);
  if (!data || !doc) notFound();
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={data.org.brand.primary} accent={data.org.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      <InvoiceDocument data={{ ...doc, contract: data.contract.number }} logoUrl={logoUrl} />
    </main>
  );
}
