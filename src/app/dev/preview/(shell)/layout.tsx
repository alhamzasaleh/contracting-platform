import { Eye } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BrandStyle } from "@/components/brand-style";
import { AppShell } from "@/components/shell/app-shell";
import { isDesignPreviewEnabled } from "@/env";
import { previewAsk } from "../preview-actions";
import { SAMPLE_ORG, SAMPLE_SHELL } from "../sample";

export const metadata = { robots: { index: false, follow: false } };

export default async function PreviewLayout({ children }: { children: React.ReactNode }) {
  if (!isDesignPreviewEnabled()) notFound();
  const t = await getTranslations("preview");
  return (
    <>
      <BrandStyle primary={SAMPLE_ORG.brand.primary} accent={SAMPLE_ORG.brand.accent} />
      <AppShell
        data={SAMPLE_SHELL}
        assistantAsk={previewAsk}
        banner={
          <div className="flex items-center justify-center gap-2 bg-foreground px-4 py-1.5 text-center text-xs font-medium text-background">
            <Eye className="size-3.5" /> {t("banner")}
          </div>
        }
      >
        {children}
      </AppShell>
    </>
  );
}
