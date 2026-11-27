import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { PrintButton } from "@/components/quotes/print-button";
import { SubStatementDocument } from "@/components/subcontractors/documents";
import { loadSubPortal } from "@/lib/sub-portal";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The subcontractor's page → his statement of account (same token checks and rate limit as the page). */
export default async function SubStatementPage({ params }: { params: Promise<{ number: string; token: string }> }) {
  const { number, token } = await params;
  const n = decodeURIComponent(number);
  const { data, logoUrl } = await loadSubPortal(n, token);
  if (!data) notFound();
  const agreements = data.agreements.map((g) => ({
    contract: g.contract, client: g.client, scope: g.scope,
    agreed: Math.round((g.basis === "lump" ? g.rate : g.rate * (g.quantity_m2 ?? 0)) * 100) / 100,
    earned: Math.round(g.work.reduce((a, w) => a + w.amount, 0) * 100) / 100,
    paid: Math.round(g.payments.reduce((a, p) => a + p.amount, 0) * 100) / 100,
  }));
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={data.org.brand.primary} accent={data.org.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton pdfHref={`/s/${encodeURIComponent(n)}/${token}/pdf/statement`} />
      </div>
      <SubStatementDocument
        org={{ name: data.org.name, legal_name: data.org.legal_name, logoUrl }}
        data={{ sub: { ...data.subcontractor, phone: null, iban: null, vat_number: null }, statement: data.statement, agreements, today: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }) }}
      />
    </main>
  );
}
