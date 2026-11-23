import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shell/app-shell";
import { SectionTabs } from "@/components/ui/section-tabs";
import { can, requirePermission } from "@/lib/auth/session";

export default async function PurchasesLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePermission("purchases.view");
  const t = await getTranslations("purchases");
  const tabs = [
    { href: "/purchases", label: t("tabPurchases"), exact: true },
    { href: "/purchases/inventory", label: t("tabInventory") },
    { href: "/purchases/subcontractors", label: t("tabSubs") },
    { href: "/purchases/petty-cash", label: t("tabPetty") },
    ...(can(session, "costs.view") ? [{ href: "/purchases/costs", label: t("tabCosts") }] : []),
  ];
  return (
    <div className="min-w-0">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <SectionTabs tabs={tabs} />
      {children}
    </div>
  );
}
