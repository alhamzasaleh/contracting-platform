import { MaterialsPrint } from "@/components/quotes/materials-print";
import { requirePermission } from "@/lib/auth/session";
import { loadQuoteMaterials } from "@/lib/data/materials";

/** Bill of quantities of a quote — quantities only (quotes.view; no price reaches the page). */
export default async function PrintQuoteMaterials({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("quotes.view");
  const doc = await loadQuoteMaterials(session, decodeURIComponent(number), false);
  return <MaterialsPrint session={session} doc={doc} path={`/print/quotations/${encodeURIComponent(doc.number)}/materials`} />;
}
