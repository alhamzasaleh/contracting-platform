import type { InvoicesPageData } from "@/lib/data/invoices";

const seller = { name: "مؤسسة ملمس", legal_name: "مؤسسة ملمس للمقاولات", cr_number: "1010123456", vat_number: null, address: "حي العليا، طريق الملك فهد", city: "الرياض", phone: "966500000001" };
const buyer = (name: string) => ({ name, id_number: "1012345678", phone: "966551234567", city: "الرياض", district: "النرجس" });

/** Preview only: illustrative invoices. */
export const SAMPLE_INVOICES: InvoicesPageData = {
  qoyodEnabled: false,
  vatRegistered: false,
  canFinance: true,
  invoices: [
    { id: "i3", number: "INV-2026-003", kind: "simple", issue_date: "2026-11-20", due_date: "2026-11-27", description: "بعد توريد المواد", seller, buyer: buyer("أبو محمد العتيبي"), subtotal: 18400, vat_percent: 0, vat: 0, total: 18400, paid: 0, contract: "C-2026-004", client: "أبو محمد العتيبي", qoyod: "none", qoyodJob: null },
    { id: "i2", number: "INV-2026-002", kind: "simple", issue_date: "2026-11-02", due_date: "2026-11-09", description: "عند التسليم النهائي", seller, buyer: buyer("أم خالد"), subtotal: 9200, vat_percent: 0, vat: 0, total: 9200, paid: 4000, contract: "C-2026-001", client: "أم خالد", qoyod: "none", qoyodJob: null },
    { id: "i1", number: "INV-2026-001", kind: "simple", issue_date: "2026-10-15", due_date: "2026-10-15", description: "عند توقيع العقد", seller, buyer: buyer("أبو محمد العتيبي"), subtotal: 18400, vat_percent: 0, vat: 0, total: 18400, paid: 18400, contract: "C-2026-004", client: "أبو محمد العتيبي", qoyod: "none", qoyodJob: null },
  ],
};
