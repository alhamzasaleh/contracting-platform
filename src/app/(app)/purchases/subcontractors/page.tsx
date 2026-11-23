import { SubcontractorsView } from "@/components/purchases/sub-petty-views";
import { requirePermission } from "@/lib/auth/session";
import { loadSubcontractors } from "@/lib/data/subcontractors";
import { addSubPayment, addSubWork, deleteSubWork, saveAgreement, saveSubcontractor } from "../actions";

export default async function SubcontractorsPage() {
  const session = await requirePermission("purchases.view");
  return (
    <SubcontractorsView
      data={await loadSubcontractors(session)}
      actions={{ saveSub: saveSubcontractor, saveAgreement, addWork: addSubWork, deleteWork: deleteSubWork, addPayment: addSubPayment }}
    />
  );
}
