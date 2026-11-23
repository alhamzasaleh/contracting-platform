import { QoyodSettingsView } from "@/components/settings/qoyod-view";
import type { QoyodPageData } from "@/lib/data/qoyod";
import type { QoyodOptions } from "@/lib/qoyod/client";

const y = new Date().getFullYear();
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

const DATA: QoyodPageData = {
  settings: {
    enabled: true, invoice_status: "Draft", inventory_id: 1, receive_account_id: 8, expense_account_id: 52, service_products: { gypsum: 11, interior: 12 },
    salary_account_id: null, cash_account_id: null, addendum_product_id: null, key_last4: "7Q2X", key_set_at: ago(30), sync_from: null,
  },
  counts: { queued: 1, done: 3, failed: 1 },
  draftInvoices: ["INV-2026-004"],
  canViewInvoices: true,
  canManage: true,
  canRetry: true,
  jobs: [
    { id: "j1", kind: "invoice", status: "done", attempts: 1, last_error: null, qoyod_id: 101, amount: null, created_at: ago(2), done_at: ago(2), label: `C-${y}-004/2 · بعد توريد المواد` },
    { id: "j2", kind: "invoice_payment", status: "done", attempts: 1, last_error: null, qoyod_id: 55, amount: 18400, created_at: ago(1), done_at: ago(1), label: `C-${y}-004/2 · بعد توريد المواد` },
    { id: "j3", kind: "bill", status: "done", attempts: 1, last_error: null, qoyod_id: 77, amount: null, created_at: ago(5), done_at: ago(5), label: `PO-${y}-006 · مؤسسة الأفق للمواد` },
    { id: "j4", kind: "invoice", status: "queued", attempts: 1, last_error: "network", qoyod_id: null, amount: null, created_at: ago(0.5), done_at: null, label: `C-${y}-005/1 · عند التوقيع` },
    { id: "j5", kind: "bill", status: "failed", attempts: 6, last_error: "HTTP 422: {\"reference\":[\"has already been taken\"]}", qoyod_id: null, amount: null, created_at: ago(26), done_at: null, label: `PO-${y}-003 · مصنع الجبس الوطني` },
  ],
};

const OPTIONS: QoyodOptions = {
  inventories: [{ id: 1, name: "المستودع الرئيسي" }],
  accounts: [
    { id: 7, code: "110101", name: "النقدية في الخزينة", receive: true, type: "Asset" },
    { id: 8, code: "110102", name: "البنك الأهلي", receive: true, type: "Asset" },
    { id: 52, code: "510101", name: "تكلفة المواد", receive: false, type: "Expense" },
  ],
  products: [
    { id: 11, name: "أعمال الجبس", sku: "GYP", sale: true },
    { id: 12, name: "دهانات داخلية", sku: "INT", sale: true },
    { id: 13, name: "دهانات خارجية", sku: "EXT", sale: true },
  ],
};

export default function PreviewQoyod() {
  return <QoyodSettingsView preview data={DATA} sampleOptions={OPTIONS} base="/dev/preview" />;
}
