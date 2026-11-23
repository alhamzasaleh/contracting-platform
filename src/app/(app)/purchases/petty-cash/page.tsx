import { PettyCashView } from "@/components/purchases/sub-petty-views";
import { requirePermission } from "@/lib/auth/session";
import { loadPettyCash } from "@/lib/data/subcontractors";
import { addPettyEntry, createPettyAccount, uploadInvoice } from "../actions";

export default async function PettyCashPage() {
  const session = await requirePermission("purchases.view");
  return <PettyCashView data={await loadPettyCash(session)} actions={{ createAccount: createPettyAccount, addEntry: addPettyEntry, upload: uploadInvoice }} />;
}
