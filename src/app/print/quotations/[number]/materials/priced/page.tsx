import { MaterialsPrint } from "@/components/quotes/materials-print";
import { requirePermission } from "@/lib/auth/session";
import { loadQuoteMaterials } from "@/lib/data/materials";

/** Bill of quantities of a quote with estimated prices (quotes.view + costs.view). */
export default async function PrintQuoteMaterialsPriced({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  await requirePermission("quotes.view");
  const session = await requirePermission("costs.view");
  const doc = await loadQuoteMaterials(session, decodeURIComponent(number), true);
  return <MaterialsPrint session={session} doc={doc} path={`/print/quotations/${encodeURIComponent(doc.number)}/materials`} />;
}
