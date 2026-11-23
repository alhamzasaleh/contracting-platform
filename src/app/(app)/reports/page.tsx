import { getTranslations } from "next-intl/server";
import { ReportsView } from "@/components/finance/reports-view";
import { PageHeader } from "@/components/shell/app-shell";
import { requirePermission } from "@/lib/auth/session";
import { loadOwnerFinance } from "@/lib/data/finance";
import { recordPayment, requestPayment, setExpectedDate } from "./actions";

export default async function ReportsPage() {
  const session = await requirePermission("finance.view");
  const t = await getTranslations("finance");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  return (
    <div className="min-w-0">
      <PageHeader title={t("reportsTitle")} description={t("reportsSubtitle")} />
      <ReportsView f={await loadOwnerFinance(session, today)} actions={{ record: recordPayment, expected: setExpectedDate, request: requestPayment }} />
    </div>
  );
}
