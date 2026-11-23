import { ExternalLink, Printer } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { InvoiceDocument } from "@/components/finance/invoice-document";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/session";
import { loadInvoice } from "@/lib/data/invoices";
import { orgLogoUrl } from "@/lib/org";

export default async function InvoicePage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("finance.view");
  const t = await getTranslations("invoice");
  const [inv, logoUrl] = await Promise.all([loadInvoice(session, decodeURIComponent(number)), orgLogoUrl(session.organization)]);
  return (
    <div className="grid gap-4">
      <PageHeader
        title={inv.kind === "tax" ? t("taxTitle") : t("title")}
        actions={
          <div className="flex flex-wrap gap-2">
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
      {inv.qoyodEnabled && <p className="text-[13px] text-muted-foreground">{t(`qoyod_${inv.qoyod}`)}</p>}
      <InvoiceDocument data={inv} logoUrl={logoUrl} />
    </div>
  );
}
