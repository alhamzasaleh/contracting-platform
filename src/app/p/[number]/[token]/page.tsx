import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BrandStyle } from "@/components/brand-style";
import { PortalView } from "@/components/portal/portal-view";
import { loadPortal } from "@/lib/portal";
import { QuoteStageView } from "@/components/portal/quote-stage";
import { acceptAddendumPortal, acceptPortal, acceptQuotePortal, addMaintenancePortal, addNotePortal, confirmMaintenancePortal, confirmStagePortal, rejectQuotePortal, requestQuoteChangesPortal } from "../../actions";

// Private link: never indexed, never leaked to other sites through the Referer header.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ClientPage({ params }: { params: Promise<{ number: string; token: string }> }) {
  const { number, token } = await params;
  const t = await getTranslations("portal");
  const n = decodeURIComponent(number);
  const { data, logoUrl, limited, unavailable, quoteStage } = await loadPortal(n, token);
  // the same link, quote stage (issued from the quote, before the contract is sent)
  if (quoteStage) {
    return (
      <>
        <BrandStyle primary={quoteStage.org.brand.primary} accent={quoteStage.org.brand.accent} />
        <QuoteStageView data={quoteStage} logoUrl={logoUrl} number={n} token={token} onAccept={acceptQuotePortal} onRequestChanges={requestQuoteChangesPortal} onReject={rejectQuotePortal} />
      </>
    );
  }
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
      <PortalView data={data} logoUrl={logoUrl} number={n} token={token} onAccept={acceptPortal} onConfirmStage={confirmStagePortal} onAddNote={addNotePortal} onAcceptAddendum={acceptAddendumPortal} onAddMaintenance={addMaintenancePortal} onConfirmMaintenance={confirmMaintenancePortal} />
    </>
  );
}
