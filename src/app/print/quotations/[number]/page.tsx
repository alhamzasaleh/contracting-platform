import { BrandStyle } from "@/components/brand-style";
import { PrintButton } from "@/components/quotes/print-button";
import { QuoteDocument } from "@/components/quotes/quote-document";
import { requirePermission } from "@/lib/auth/session";
import { loadPricingSettings } from "@/lib/data/catalogue";
import { loadQuote } from "@/lib/data/quotes";
import { orgLogoUrl } from "@/lib/org";

/** Print-ready quote (Share → Print → Save as PDF on the iPad). */
export default async function PrintQuotePage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("quotes.view");
  const [detail, settings, logoUrl] = await Promise.all([
    loadQuote(session, decodeURIComponent(number)),
    loadPricingSettings(session),
    orgLogoUrl(session.organization),
  ]);
  const o = session.organization;
  if (!detail.current) return null;
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={o.brand.primary} accent={o.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      <QuoteDocument
        org={{ name: o.name, legal_name: o.legal_name, cr_number: o.cr_number, vat_number: o.vat_number, phone: o.phone, city: o.city, logoUrl }}
        number={detail.quote.number}
        version={detail.current.version}
        date={detail.current.created_at}
        validUntil={detail.quote.valid_until}
        client={detail.client}
        view={detail.current.clientView}
        notes={detail.current.notes}
        warrantyMonths={Number(settings?.default_warranty_months ?? 6)}
      />
    </main>
  );
}
