import { BrandStyle } from "@/components/brand-style";
import { PrintButton } from "@/components/quotes/print-button";
import { SubStatementDocument } from "@/components/subcontractors/documents";
import { requirePermission } from "@/lib/auth/session";
import { loadSubStatement } from "@/lib/data/subcontractors";
import { orgLogoUrl } from "@/lib/org";

/** A subcontractor's statement of account (purchases.view, like the subcontractors page). */
export default async function PrintSubStatementPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("purchases.view");
  const o = session.organization;
  const n = decodeURIComponent(number);
  const [doc, logoUrl] = await Promise.all([loadSubStatement(session, n), orgLogoUrl(o)]);
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={o.brand.primary} accent={o.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton pdfHref={`/api/pdf/subcontractors/${encodeURIComponent(n)}/statement`} />
      </div>
      <SubStatementDocument org={{ name: o.name, legal_name: o.legal_name, cr_number: o.cr_number, city: o.city, address: o.address, logoUrl }} data={doc} />
    </main>
  );
}
