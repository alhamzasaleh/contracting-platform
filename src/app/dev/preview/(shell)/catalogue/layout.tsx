import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shell/app-shell";
import { SectionTabs } from "@/components/ui/section-tabs";

export default async function PreviewCatalogueLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("catalogue");
  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <SectionTabs
        basePath="/dev/preview"
        tabs={[
          { href: "/catalogue", label: t("tabServices"), exact: true },
          { href: "/catalogue/products", label: t("tabProducts") },
          { href: "/catalogue/systems", label: t("tabSystems") },
          { href: "/catalogue/suppliers", label: t("tabSuppliers") },
          { href: "/catalogue/calculator", label: t("tabCalculator") },
          { href: "/catalogue/rates", label: t("tabRates") },
          { href: "/catalogue/labour", label: t("tabLabour") },
          { href: "/catalogue/settings", label: t("tabSettings") },
        ]}
      />
      {children}
    </div>
  );
}
