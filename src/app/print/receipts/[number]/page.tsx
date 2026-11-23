import { BrandStyle } from "@/components/brand-style";
import { ReceiptVoucher } from "@/components/finance/receipt-voucher";
import { PrintButton } from "@/components/quotes/print-button";
import { requirePermission } from "@/lib/auth/session";
import { loadReceipt } from "@/lib/data/receipts";
import { orgLogoUrl } from "@/lib/org";

/** Print-ready receipt voucher (Share → Print → Save as PDF). */
export default async function PrintReceiptPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("quotes.view");
  const o = session.organization;
  const [doc, logoUrl] = await Promise.all([loadReceipt(session, decodeURIComponent(number)), orgLogoUrl(o)]);
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={o.brand.primary} accent={o.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton pdfHref={`/api/pdf/receipts/${encodeURIComponent(decodeURIComponent(number))}`} />
      </div>
      <ReceiptVoucher data={{ ...doc, org: { ...doc.org, logoUrl } }} />
    </main>
  );
}
