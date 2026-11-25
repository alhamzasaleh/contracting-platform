import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { PaymentVoucher } from "@/components/marketers/payment-voucher";
import { isDesignPreviewEnabled } from "@/env";
import { SAMPLE_ORG } from "../sample";
import { SAMPLE_LOGO } from "../sample-logo";

export default function PreviewPaymentVoucher() {
  if (!isDesignPreviewEnabled()) notFound();
  return (
    <main className="min-h-dvh bg-background py-6">
      <BrandStyle primary={SAMPLE_ORG.brand.primary} accent={SAMPLE_ORG.brand.accent} />
      <PaymentVoucher
        data={{
          org: { ...SAMPLE_ORG, logoUrl: SAMPLE_LOGO },
          voucher: { number: "PV-2026-001", paid_on: "2026-11-23", amount: 2300, method: "transfer", reference: "TRX-88231", note: null },
          marketer: { number: "MK-2026-001", name: "سعد بن فهد الدوسري", iban: "SA0380000000608010167519" },
          contract: { number: "C-2026-004", client: "أبو محمد العتيبي", base: 46000, percent: 5 },
        }}
      />
    </main>
  );
}
