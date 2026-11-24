import { getTranslations } from "next-intl/server";
import { ContractEditor } from "@/components/contracts/contract-views";
import { PageHeader } from "@/components/shell/app-shell";
import { requirePermission } from "@/lib/auth/session";
import { loadContractDraft } from "@/lib/data/contracts";
import { loadBusy } from "@/lib/data/schedule";
import { saveContract } from "../../actions";

export default async function EditContractPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("quotes.manage");
  const t = await getTranslations("contract");
  const [draft, busy] = await Promise.all([loadContractDraft(session, { contractNumber: decodeURIComponent(number) }), loadBusy(session)]);
  return (
    <div>
      <PageHeader title={t("editTitle", { number: draft.contract!.number })} />
      <ContractEditor draft={draft} onSave={saveContract} busy={busy} />
    </div>
  );
}
