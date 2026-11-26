import { FramingPrint } from "@/components/quotes/framing-print";
import { requirePermission } from "@/lib/auth/session";
import { loadQuoteFraming } from "@/lib/data/framing";

/** Metal framing plan of a quote's current version (quotes.view, no prices — like the bill of quantities). */
export default async function PrintQuoteFraming({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("quotes.view");
  const doc = await loadQuoteFraming(session, decodeURIComponent(number));
  return <FramingPrint session={session} doc={doc} path={`/print/quotations/${encodeURIComponent(doc.number)}/framing`} />;
}
