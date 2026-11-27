import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { MeasurementDocument } from "@/components/projects/measurement-document";
import { PrintButton } from "@/components/quotes/print-button";
import { loadPortal } from "@/lib/portal";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Client page → one measurement sheet as sent to him (same token checks and rate limit as the page itself). */
export default async function PortalMeasurementPage({ params }: { params: Promise<{ number: string; token: string; ms: string }> }) {
  const { number, token, ms } = await params;
  const n = decodeURIComponent(number);
  const msNumber = decodeURIComponent(ms);
  if (!/^MS-\d{4}-\d{3,6}$/.test(msNumber)) notFound();
  const { data, logoUrl } = await loadPortal(n, token);
  const sheet = data?.measurements?.find((m) => m.number === msNumber);
  if (!data || !sheet) notFound();
  const o = data.org;
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={o.brand.primary} accent={o.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton pdfHref={`/p/${encodeURIComponent(n)}/${token}/pdf/${encodeURIComponent(msNumber)}`} />
      </div>
      <MeasurementDocument
        data={{
          org: { name: o.name, legal_name: o.legal_name, cr_number: o.cr_number, logoUrl },
          client: { name: data.client.name },
          contract: { number: data.contract.number },
          sheet: { ...sheet, signature: sheet.client_signature ?? null },
        }}
      />
    </main>
  );
}
