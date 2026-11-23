import { getTranslations } from "next-intl/server";
import { AssistantView } from "@/components/assistant/assistant-view";
import { PageHeader } from "@/components/shell/app-shell";
import { aiConfigured } from "@/lib/ai/invoice";
import { requirePermission } from "@/lib/auth/session";
import { askFinanceAssistant } from "./actions";

export default async function AssistantPage() {
  await requirePermission("finance.view");
  const t = await getTranslations("assistant");
  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <AssistantView ready={aiConfigured()} ask={askFinanceAssistant} />
    </div>
  );
}
