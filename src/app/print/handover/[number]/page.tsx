import { BrandStyle } from "@/components/brand-style";
import { HandoverCertificate } from "@/components/projects/handover-certificate";
import { PrintButton } from "@/components/quotes/print-button";
import { requirePermission } from "@/lib/auth/session";
import { loadCertificate } from "@/lib/data/projects";
import { signedAssetUrl } from "@/lib/org";

/** Print-ready final handover certificate (Share → Print → Save as PDF). */
export default async function PrintHandoverPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("projects.view");
  const [c, logoUrl] = await Promise.all([loadCertificate(session, decodeURIComponent(number)), signedAssetUrl(session.organization.logo_path)]);
  const o = session.organization;
  return (
    <main className="min-h-dvh bg-neutral-100 py-6 print:bg-white print:py-0">
      <BrandStyle primary={o.brand.primary} accent={o.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      <HandoverCertificate
        data={{
          org: { name: o.name, legal_name: o.legal_name, cr_number: o.cr_number, logoUrl },
          client: { name: c.client?.name ?? "—", id_number: c.client?.id_number ?? null },
          contract: { number: c.contract.number, service: c.contract.service, warranty_months: c.contract.warranty_months },
          final: { confirmed_at: c.final.confirmed_at!, confirmed_name: c.final.confirmed_name, signature: c.final.confirmed_signature },
        }}
      />
    </main>
  );
}
