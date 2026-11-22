import { SuppliersView } from "@/components/catalogue/suppliers-view";
import { can, getSession } from "@/lib/auth/session";
import { loadSuppliers } from "@/lib/data/catalogue";
import { saveSupplier } from "../actions";

export default async function SuppliersPage() {
  const session = await getSession();
  const suppliers = await loadSuppliers(session);
  return <SuppliersView suppliers={suppliers} canManage={can(session, "catalogue.manage")} onSave={saveSupplier} />;
}
