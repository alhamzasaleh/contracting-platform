import { MaterialsView } from "@/components/catalogue/materials-view";
import { can, getSession } from "@/lib/auth/session";
import { loadMaterials, loadSuppliers } from "@/lib/data/catalogue";
import { addMaterialPrice, saveMaterial } from "../actions";

export default async function MaterialsPage() {
  const session = await getSession();
  const [materials, suppliers] = await Promise.all([loadMaterials(session), loadSuppliers(session)]);
  return (
    <MaterialsView
      materials={materials}
      suppliers={suppliers}
      canManage={can(session, "catalogue.manage")}
      canSeeCosts={can(session, "costs.view")}
      actions={{ saveMaterial, addPrice: addMaterialPrice }}
    />
  );
}
