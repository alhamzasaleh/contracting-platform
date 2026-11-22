import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shell/app-shell";
import { SectionTabs } from "@/components/ui/section-tabs";
import { can, requirePermission } from "@/lib/auth/session";

export default async function CatalogueLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePermission("catalogue.view");
  const t = await getTranslations("catalogue");
  const tabs = [
    { href: "/catalogue", label: t("tabServices"), exact: true },
    { href: "/catalogue/products", label: t("tabProducts") },
    { href: "/catalogue/suppliers", label: t("tabSuppliers") },
    ...(can(session, "costs.view")
      ? [
          { href: "/catalogue/calculator", label: t("tabCalculator") },
          { href: "/catalogue/rates", label: t("tabRates") },
          { href: "/catalogue/labour", label: t("tabLabour") },
          { href: "/catalogue/settings", label: t("tabSettings") },
        ]
      : []),
  ];
  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <SectionTabs tabs={tabs} />
      {children}
    </div>
  );
}
