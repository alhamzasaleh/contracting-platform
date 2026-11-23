import { getTranslations } from "next-intl/server";
import { QuoteEditorView } from "@/components/quotes/quote-views";
import { PageHeader } from "@/components/shell/app-shell";
import { requirePermission } from "@/lib/auth/session";
import { loadQuoteEditor } from "@/lib/data/quotes";
import { saveQuoteVersion } from "../../actions";

export default async function EditQuotePage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("quotes.manage");
  await requirePermission("costs.view");
  const t = await getTranslations("quotes");
  const d = await loadQuoteEditor(session, { quoteNumber: decodeURIComponent(number) });
  return (
    <div>
      <PageHeader title={t("newVersionOf", { number: d.quote!.number })} description={t(`service_${d.kind}`)} />
      <QuoteEditorView {...d} quote={d.quote} onSave={saveQuoteVersion} />
    </div>
  );
}
