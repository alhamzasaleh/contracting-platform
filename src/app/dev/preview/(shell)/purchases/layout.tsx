import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shell/app-shell";
import { SectionTabs } from "@/components/ui/section-tabs";

export default async function PreviewPurchasesLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("purchases");
  return (
    <div className="min-w-0">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <SectionTabs
        basePath="/dev/preview"
        tabs={[
          { href: "/purchases", label: t("tabPurchases"), exact: true },
          { href: "/purchases/inventory", label: t("tabInventory") },
    { href: "/purchases/subcontractors", label: t("tabSubs") },
    { href: "/purchases/petty-cash", label: t("tabPetty") },
          { href: "/purchases/costs", label: t("tabCosts") },
        ]}
      />
      {children}
    </div>
  );
}
