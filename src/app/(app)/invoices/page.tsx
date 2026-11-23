import { getTranslations } from "next-intl/server";
import { InvoicesView } from "@/components/finance/invoices-view";
import { PageHeader } from "@/components/shell/app-shell";
import { requirePermission } from "@/lib/auth/session";
import { loadInvoices } from "@/lib/data/invoices";

export default async function InvoicesPage() {
  const session = await requirePermission("finance.view");
  const t = await getTranslations("invoice");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  return (
    <div>
      <PageHeader title={t("listTitle")} description={t("listSubtitle")} />
      <InvoicesView data={await loadInvoices(session)} today={today} />
    </div>
  );
}
