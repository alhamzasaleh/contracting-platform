import { MaterialsPrint } from "@/components/quotes/materials-print";
import { requirePermission } from "@/lib/auth/session";
import { loadProjectMaterials } from "@/lib/data/materials";

/** Bill of quantities of a project (its contract's agreed version) with bought / still to buy — quantities only. */
export default async function PrintProjectMaterials({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("quotes.view");
  const doc = await loadProjectMaterials(session, decodeURIComponent(number), false);
  return <MaterialsPrint session={session} doc={doc} path={`/print/contracts/${encodeURIComponent(doc.number)}/materials`} />;
}
