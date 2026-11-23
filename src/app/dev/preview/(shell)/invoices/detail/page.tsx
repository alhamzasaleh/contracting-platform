import { InvoiceDocument } from "@/components/finance/invoice-document";
import { InvoiceLinks } from "@/components/finance/invoices-view";
import { SAMPLE_LOGO } from "../../../sample-logo";
import { SAMPLE_INVOICES } from "../../../sample-invoices";

export default function PreviewInvoice() {
  const inv = SAMPLE_INVOICES.invoices[1];
  return (
    <div className="grid gap-4">
      <InvoiceLinks contract={inv.contract} canViewContract base="/dev/preview" receipts={[{ number: "RV-2026-004", amount: 4000 }]} />
      <InvoiceDocument data={inv} logoUrl={SAMPLE_LOGO} />
    </div>
  );
}
