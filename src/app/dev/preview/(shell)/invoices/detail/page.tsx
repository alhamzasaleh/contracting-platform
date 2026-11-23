import { InvoiceDocument } from "@/components/finance/invoice-document";
import { SAMPLE_LOGO } from "../../../sample-logo";
import { SAMPLE_INVOICES } from "../../../sample-invoices";

export default function PreviewInvoice() {
  return <InvoiceDocument data={SAMPLE_INVOICES.invoices[1]} logoUrl={SAMPLE_LOGO} />;
}
