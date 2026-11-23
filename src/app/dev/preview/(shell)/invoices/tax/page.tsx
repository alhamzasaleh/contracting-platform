import { InvoiceDocument } from "@/components/finance/invoice-document";
import { invoiceQr } from "@/lib/qr";
import { SAMPLE_LOGO } from "../../../sample-logo";
import { SAMPLE_INVOICES } from "../../../sample-invoices";

/** A tax invoice (company with a VAT number) with its ZATCA QR. */
export default async function PreviewTaxInvoice() {
  const base = SAMPLE_INVOICES.invoices[1];
  const inv = { ...base, kind: "tax" as const, seller: { ...base.seller, vat_number: "310000000000003" }, subtotal: 8000, vat_percent: 15, vat: 1200, total: 9200, created_at: "2026-11-02T09:30:00Z" };
  return <InvoiceDocument data={inv} logoUrl={SAMPLE_LOGO} qr={await invoiceQr(inv)} />;
}
