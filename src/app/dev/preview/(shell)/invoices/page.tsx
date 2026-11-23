import { InvoicesView } from "@/components/finance/invoices-view";
import { PageHeader } from "@/components/shell/app-shell";
import { SAMPLE_INVOICES } from "../../sample-invoices";

export default function PreviewInvoices() {
  return (
    <div>
      <PageHeader title="الفواتير" description="فاتورة لكل دفعة مطلوبة من العميل ولكل ملحق — تطلع تلقائياً." />
      <InvoicesView data={SAMPLE_INVOICES} base="/dev/preview" today="2026-11-23" />
    </div>
  );
}
