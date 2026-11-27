import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { PrintButton } from "@/components/quotes/print-button";
import { SubVoucherDocument } from "@/components/subcontractors/documents";
import { loadSubPortalVoucher } from "@/lib/sub-portal";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The subcontractor's page → one of his payment vouchers (same token checks and rate limit as the page). */
export default async function SubVoucherPage({ params }: { params: Promise<{ number: string; token: string; sp: string }> }) {
  const { number, token, sp } = await params;
  const n = decodeURIComponent(number);
  const v = decodeURIComponent(sp);
  const { doc, org, brand } = await loadSubPortalVoucher(n, token, v);
  if (!doc || !org || !brand) notFound();
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={brand.primary} accent={brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton pdfHref={`/s/${encodeURIComponent(n)}/${token}/pdf/${encodeURIComponent(v)}`} />
      </div>
      <SubVoucherDocument org={org} data={doc} />
    </main>
  );
}
