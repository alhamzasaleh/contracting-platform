import { getTranslations } from "next-intl/server";
import { QuotesView } from "@/components/quotes/quote-views";
import { PageHeader } from "@/components/shell/app-shell";
import { requirePermission } from "@/lib/auth/session";
import { loadQuotes } from "@/lib/data/quotes";

export default async function QuotationsPage() {
  const session = await requirePermission("quotes.view");
  const t = await getTranslations("quotes");
  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <QuotesView quotes={await loadQuotes(session)} />
    </div>
  );
}
