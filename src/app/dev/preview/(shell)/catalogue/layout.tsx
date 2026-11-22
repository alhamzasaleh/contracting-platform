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
          { href: "/catalogue/materials", label: t("tabMaterials") },
          { href: "/catalogue/labour", label: t("tabLabour") },
          { href: "/catalogue/settings", label: t("tabSettings") },
        ]}
      />
      {children}
    </div>
  );
}
