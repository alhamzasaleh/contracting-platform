import { BrandStyle } from "@/components/brand-style";
import { MeasurementDocument } from "@/components/projects/measurement-document";
import { PrintButton } from "@/components/quotes/print-button";
import { requirePermission } from "@/lib/auth/session";
import { loadMeasurementDoc } from "@/lib/data/measurements";
import { orgLogoUrl } from "@/lib/org";

/** Print-ready measurement sheet (Share → Print → Save as PDF). */
export default async function PrintMeasurementPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("projects.view");
  const o = session.organization;
  const n = decodeURIComponent(number);
  const [doc, logoUrl] = await Promise.all([loadMeasurementDoc(session, n), orgLogoUrl(o)]);
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={o.brand.primary} accent={o.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton pdfHref={`/api/pdf/measurements/${encodeURIComponent(n)}`} />
      </div>
      <MeasurementDocument data={{ ...doc, org: { name: o.name, legal_name: o.legal_name, cr_number: o.cr_number, logoUrl } }} />
    </main>
  );
}
