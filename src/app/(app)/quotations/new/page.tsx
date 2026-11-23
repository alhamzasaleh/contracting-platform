import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { QuoteEditorView } from "@/components/quotes/quote-views";
import { PageHeader } from "@/components/shell/app-shell";
import { requirePermission } from "@/lib/auth/session";
import { loadQuoteEditor } from "@/lib/data/quotes";
import { saveQuoteVersion } from "../actions";

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ survey?: string; service?: string }> }) {
  const { survey, service } = await searchParams;
  if (!survey || !["gypsum", "interior", "exterior"].includes(service ?? "")) notFound();
  const session = await requirePermission("quotes.manage");
  await requirePermission("costs.view");
  const t = await getTranslations("quotes");
  const d = await loadQuoteEditor(session, { surveyNumber: survey, service: service as "gypsum" | "interior" | "exterior" });
  return (
    <div>
      <PageHeader title={t("newQuote")} description={t(`service_${d.kind}`)} />
      <QuoteEditorView {...d} quote={null} onSave={saveQuoteVersion} />
    </div>
  );
}
