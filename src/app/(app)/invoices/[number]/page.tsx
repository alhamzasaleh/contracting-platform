import { ExternalLink, Printer } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { InvoiceDocument } from "@/components/finance/invoice-document";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { InvoiceLinks } from "@/components/finance/invoices-view";
import { can, requirePermission } from "@/lib/auth/session";
import { loadInvoice } from "@/lib/data/invoices";
import { orgLogoUrl } from "@/lib/org";
import { invoiceQr } from "@/lib/qr";
import { ltr } from "@/lib/utils";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { getFormatter } from "@/i18n/server";

export default async function InvoicePage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("finance.view");
  const t = await getTranslations("invoice");
  const tw = await getTranslations("wa");
  const fmt = await getFormatter();
  const [inv, logoUrl] = await Promise.all([loadInvoice(session, decodeURIComponent(number)), orgLogoUrl(session.organization)]);
  return (
    <div className="grid gap-4">
      <PageHeader
        title={inv.kind === "tax" ? t("taxTitle") : t("title")}
        actions={
          <div className="flex flex-wrap gap-2">
            <WhatsAppButton
              size="md"
              phone={inv.buyer.phone}
              label={tw("btnSend")}
              text={tw("invoice", { name: inv.buyer.name ?? "", number: ltr(inv.number), amount: fmt.money(inv.total), contract: ltr(inv.contract), org: inv.seller.legal_name ?? inv.seller.name ?? session.organization.name })}
            />
            {inv.qoyodJob && (
              <Button asChild variant="secondary">
                <a href={`/api/qoyod/invoice/${inv.qoyodJob}`} target="_blank" rel="noopener noreferrer"><ExternalLink /> {t("official")}</a>
              </Button>
            )}
            <Button asChild>
              <Link href={`/print/invoices/${inv.number}`} target="_blank"><Printer /> {t("print")}</Link>
            </Button>
          </div>
        }
      />
      <InvoiceLinks contract={inv.contract} canViewContract={can(session, "quotes.view")} receipts={inv.receipts} />
      {inv.qoyodEnabled && <p className="text-[13px] text-muted-foreground">{t(`qoyod_${inv.qoyod}`)}</p>}
      <InvoiceDocument data={inv} logoUrl={logoUrl} qr={await invoiceQr(inv)} />
    </div>
  );
}
