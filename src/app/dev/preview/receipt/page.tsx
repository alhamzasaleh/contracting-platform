import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { ReceiptVoucher } from "@/components/finance/receipt-voucher";
import { isDesignPreviewEnabled } from "@/env";
import { SAMPLE_ORG } from "../sample";
import { SAMPLE_LOGO } from "../sample-logo";

export default function PreviewReceipt() {
  if (!isDesignPreviewEnabled()) notFound();
  return (
    <main className="min-h-dvh bg-background py-6">
      <BrandStyle primary={SAMPLE_ORG.brand.primary} accent={SAMPLE_ORG.brand.accent} />
      <ReceiptVoucher
        data={{
          org: { ...SAMPLE_ORG, logoUrl: SAMPLE_LOGO },
          client: { name: "أبو محمد العتيبي", phone: "966551234567" },
          contract: { number: "C-2026-004", value: 46000 },
          receipt: { number: "RV-2026-007", label: "بعد توريد المواد", amount: 18400, paid_on: "2026-11-23", method: "transfer", reference: "TRX-88231", created_at: "2026-11-23T09:30:00Z" },
          receivedToDate: 36800,
          remaining: 9200,
        }}
      />
    </main>
  );
}
