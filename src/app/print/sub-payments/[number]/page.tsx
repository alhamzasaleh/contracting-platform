import { BrandStyle } from "@/components/brand-style";
import { PrintButton } from "@/components/quotes/print-button";
import { SubVoucherDocument } from "@/components/subcontractors/documents";
import { requirePermission } from "@/lib/auth/session";
import { loadSubVoucher } from "@/lib/data/subcontractors";
import { orgLogoUrl } from "@/lib/org";

/** A subcontractor payment voucher (SP-) — finance.view, like every money document. */
export default async function PrintSubVoucherPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("finance.view");
  const o = session.organization;
  const n = decodeURIComponent(number);
  const [doc, logoUrl] = await Promise.all([loadSubVoucher(session, n), orgLogoUrl(o)]);
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={o.brand.primary} accent={o.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton pdfHref={`/api/pdf/sub-payments/${encodeURIComponent(n)}`} />
      </div>
      <SubVoucherDocument
        org={{ name: o.name, legal_name: o.legal_name, cr_number: o.cr_number, city: o.city, address: o.address, signatory_name: o.signatory_name, signatory_title: o.signatory_title, logoUrl }}
        data={doc}
      />
    </main>
  );
}
