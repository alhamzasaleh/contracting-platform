import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { ReceiptVoucher } from "@/components/finance/receipt-voucher";
import { PrintButton } from "@/components/quotes/print-button";
import { loadPortal } from "@/lib/portal";
import { receiptTotals } from "@/lib/receipts";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Client page → one receipt voucher (same token checks and rate limit as the page itself). */
export default async function PortalReceiptPage({ params }: { params: Promise<{ number: string; token: string; rv: string }> }) {
  const { number, token, rv } = await params;
  const n = decodeURIComponent(number);
  const rvNumber = decodeURIComponent(rv);
  if (!/^RV-\d{4}-\d{3,6}$/.test(rvNumber)) notFound();
  const { data, logoUrl } = await loadPortal(n, token);
  if (!data) notFound();
  const value = data.contract.total + (data.addenda ?? []).filter((a) => a.status === "accepted").reduce((s, a) => s + a.total, 0);
  const totals = receiptTotals(data.receipts ?? [], rvNumber, value);
  if (!totals) notFound();
  const o = data.org;
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={o.brand.primary} accent={o.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton pdfHref={`/p/${encodeURIComponent(n)}/${token}/pdf/${encodeURIComponent(rvNumber)}`} />
      </div>
      <ReceiptVoucher
        data={{
          org: { name: o.name, legal_name: o.legal_name, cr_number: o.cr_number, vat_number: o.vat_number, phone: o.phone, city: o.city, address: o.address, signatory_name: o.signatory_name, signatory_title: o.signatory_title, logoUrl },
          client: { name: data.client.name, phone: data.client.phone },
          contract: { number: data.contract.number, value },
          ...totals,
        }}
      />
    </main>
  );
}
