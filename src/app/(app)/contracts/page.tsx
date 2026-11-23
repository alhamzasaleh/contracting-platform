import { getTranslations } from "next-intl/server";
import { ContractsView } from "@/components/contracts/contract-views";
import { PageHeader } from "@/components/shell/app-shell";
import { requirePermission } from "@/lib/auth/session";
import { loadContracts } from "@/lib/data/contracts";

export default async function ContractsPage() {
  const session = await requirePermission("quotes.view");
  const t = await getTranslations("contract");
  return (
    <div>
      <PageHeader title={t("listTitle")} description={t("listSubtitle")} />
      <ContractsView contracts={await loadContracts(session)} />
    </div>
  );
}
