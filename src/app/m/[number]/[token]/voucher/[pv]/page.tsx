import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { PaymentVoucher } from "@/components/marketers/payment-voucher";
import { PrintButton } from "@/components/quotes/print-button";
import { loadMarketerVoucher } from "@/lib/marketer-portal";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The success partner's page → one of his payment vouchers (same token checks and rate limit as the page). */
export default async function PartnerVoucherPage({ params }: { params: Promise<{ number: string; token: string; pv: string }> }) {
  const { number, token, pv } = await params;
  const n = decodeURIComponent(number);
  const v = decodeURIComponent(pv);
  const { doc, brand } = await loadMarketerVoucher(n, token, v);
  if (!doc || !brand) notFound();
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={brand.primary} accent={brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton pdfHref={`/m/${encodeURIComponent(n)}/${token}/pdf/${encodeURIComponent(v)}`} />
      </div>
      <PaymentVoucher data={doc} />
    </main>
  );
}
