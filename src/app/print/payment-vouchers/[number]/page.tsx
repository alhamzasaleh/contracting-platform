import { BrandStyle } from "@/components/brand-style";
import { PaymentVoucher } from "@/components/marketers/payment-voucher";
import { PrintButton } from "@/components/quotes/print-button";
import { requirePermission } from "@/lib/auth/session";
import { loadPaymentVoucher } from "@/lib/data/marketers";
import { orgLogoUrl } from "@/lib/org";

/** Print-ready payment voucher (سند صرف) of a success partner's reward. */
export default async function PrintPaymentVoucherPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("finance.view");
  const o = session.organization;
  const n = decodeURIComponent(number);
  const [doc, logoUrl] = await Promise.all([loadPaymentVoucher(session, n), orgLogoUrl(o)]);
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={o.brand.primary} accent={o.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton pdfHref={`/api/pdf/payment-vouchers/${encodeURIComponent(n)}`} />
      </div>
      <PaymentVoucher data={{ ...doc, org: { ...doc.org, logoUrl } }} />
    </main>
  );
}
