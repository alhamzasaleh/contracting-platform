import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ContractEditor } from "@/components/contracts/contract-views";
import { PageHeader } from "@/components/shell/app-shell";
import { requirePermission } from "@/lib/auth/session";
import { loadContractDraft } from "@/lib/data/contracts";
import { loadBusy } from "@/lib/data/schedule";
import { saveContract } from "../actions";

export default async function NewContractPage({ searchParams }: { searchParams: Promise<{ quote?: string }> }) {
  const { quote } = await searchParams;
  if (!quote) notFound();
  const session = await requirePermission("quotes.manage");
  const t = await getTranslations("contract");
  const draft = await loadContractDraft(session, { quoteNumber: quote });
  return (
    <div>
      <PageHeader title={t("newTitle")} description={t("newSubtitle")} />
      <ContractEditor draft={draft} onSave={saveContract} busy={await loadBusy(session)} />
    </div>
  );
}
