import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { HandoverCertificate } from "@/components/projects/handover-certificate";
import { PrintButton } from "@/components/quotes/print-button";
import { loadPortal } from "@/lib/portal";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Client page → the final handover certificate (only once the client has signed it). */
export default async function PortalHandoverPage({ params }: { params: Promise<{ number: string; token: string }> }) {
  const { number, token } = await params;
  const n = decodeURIComponent(number);
  const { data, logoUrl } = await loadPortal(n, token);
  const final = data?.execution?.stages.find((s) => s.is_final && s.status === "confirmed");
  if (!data || !final?.confirmed_at) notFound();
  const { contract: c, org } = data;
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={org.brand.primary} accent={org.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton pdfHref={`/p/${encodeURIComponent(n)}/${token}/pdf/handover`} />
      </div>
      <HandoverCertificate
        data={{
          org: { name: org.name, legal_name: org.legal_name, cr_number: org.cr_number, logoUrl },
          client: { name: data.client.name, id_number: data.client.id_number },
          contract: { number: c.number, service: c.service, warranty_months: c.warranty_months },
          final: { confirmed_at: final.confirmed_at, confirmed_name: final.confirmed_name },
        }}
      />
    </main>
  );
}
