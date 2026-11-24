import { MaterialsPrint } from "@/components/quotes/materials-print";
import { requirePermission } from "@/lib/auth/session";
import { loadProjectMaterials } from "@/lib/data/materials";

/** Bill of quantities of a project with estimated prices (quotes.view + costs.view). */
export default async function PrintProjectMaterialsPriced({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  await requirePermission("quotes.view");
  const session = await requirePermission("costs.view");
  const doc = await loadProjectMaterials(session, decodeURIComponent(number), true);
  return <MaterialsPrint session={session} doc={doc} path={`/print/contracts/${encodeURIComponent(doc.number)}/materials`} />;
}
