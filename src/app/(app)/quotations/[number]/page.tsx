import { getTranslations } from "next-intl/server";
import { QuoteView } from "@/components/quotes/quote-views";
import { PageHeader } from "@/components/shell/app-shell";
import { requirePermission } from "@/lib/auth/session";
import { loadPricingSettings } from "@/lib/data/catalogue";
import { loadQuote } from "@/lib/data/quotes";
import { logoDataUrl } from "@/lib/org";
import { decideApproval, issueQuote } from "../actions";

export default async function QuotePage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("quotes.view");
  const t = await getTranslations("quotes");
  const [detail, settings, logoUrl] = await Promise.all([
    loadQuote(session, decodeURIComponent(number)),
    loadPricingSettings(session),
    logoDataUrl(session.organization.logo_path),
  ]);
  const o = session.organization;
  return (
    <div>
      <PageHeader title={t("quote")} />
      <QuoteView
        detail={detail}
        org={{ name: o.name, legal_name: o.legal_name, cr_number: o.cr_number, vat_number: o.vat_number, phone: o.phone, city: o.city, logoUrl }}
        warrantyMonths={Number(settings?.default_warranty_months ?? 6)}
        actions={{ issue: issueQuote, decide: decideApproval }}
      />
    </div>
  );
}
