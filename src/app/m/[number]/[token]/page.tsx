import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BrandStyle } from "@/components/brand-style";
import { MarketerPortalView } from "@/components/marketers/marketer-portal";
import { loadMarketerPortal } from "@/lib/marketer-portal";

// Private link: never indexed, never leaked to other sites through the Referer header.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The success partner's page: his clients' contracts and his reward. */
export default async function MarketerPage({ params }: { params: Promise<{ number: string; token: string }> }) {
  const { number, token } = await params;
  const t = await getTranslations("portal");
  const { data, logoUrl, limited, unavailable } = await loadMarketerPortal(decodeURIComponent(number), token);
  if (!data) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div className="max-w-sm text-center">
          <p className="text-[20px] font-bold">{limited ? t("limitedTitle") : unavailable ? t("unavailableTitle") : t("invalidTitle")}</p>
          <p className="mt-2 text-[14px] text-muted-foreground">{limited ? t("limitedBody") : unavailable ? t("unavailableBody") : t("invalidBody")}</p>
        </div>
      </main>
    );
  }
  return (
    <>
      <BrandStyle primary={data.org.brand.primary} accent={data.org.brand.accent} />
      <MarketerPortalView data={data} logoUrl={logoUrl} />
    </>
  );
}
