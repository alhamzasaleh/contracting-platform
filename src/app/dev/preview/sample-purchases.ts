import type { InventoryData, ProjectCost, PurchaseForm, PurchaseListItem } from "@/lib/data/purchases";

const projects = [
  { id: "k0", number: "C-2026-003", client: "شركة البناء المتقن", status: "accepted" },
  { id: "k1", number: "C-2026-004", client: "أبو محمد العتيبي", status: "sent" },
];
const items = [
  { id: "i1", name: "لوح جبس عادي 12.5 مم", unit: "board", is_general: true },
  { id: "i2", name: "مسامير ألواح (علبة 1000)", unit: "box", is_general: true },
  { id: "i3", name: "دهان جوتن — لون العميل (بيج)", unit: "pail", is_general: false },
];

export const SAMPLE_PURCHASES: PurchaseListItem[] = [
  { id: "p3", number: "PO-2026-003", status: "pending_approval", supplier: "مؤسسة مواد البناء الحديثة", invoice_number: "88412", invoice_date: "2026-11-22", project: projects[0], charge: { kind: "project", number: projects[0].number, client: projects[0].client, href: `/contracts/${projects[0].number}` }, total: 7245, created_at: "2026-11-22T10:00:00Z" },
  { id: "p2", number: "PO-2026-002", status: "recorded", supplier: "معرض الألوان", invoice_number: "A-5521", invoice_date: "2026-11-20", project: projects[1], charge: { kind: "project", number: projects[1].number, client: projects[1].client, href: `/contracts/${projects[1].number}` }, total: 2070, created_at: "2026-11-20T10:00:00Z" },
  { id: "p1", number: "PO-2026-001", status: "recorded", supplier: "مؤسسة مواد البناء الحديثة", invoice_number: "88200", invoice_date: "2026-11-18", project: null, charge: { kind: "stock" }, total: 3105, created_at: "2026-11-18T10:00:00Z" },
];

const detail = {
  ...SAMPLE_PURCHASES[0], supplier_id: null, supplier_vat: "300123456700003", subtotal: 6300, vat: 945, notes: null, ai_extracted: true,
  ai_flags: { flags: ["vatNot15"] }, attachment_path: null, attachmentUrl: null, attachmentIsPdf: false,
  approval: { id: "ap1", status: "pending", limit: 5000 }, canManage: true, canDecide: true, paid: null, canPay: true,
  lines: [
    { seq: 1, kind: "material" as const, item_id: "i1", description: "لوح جبس عادي 12.5 مم", colour: null, quantity: 250, unit: "board", unit_price: 22, amount: 5500 },
    { seq: 2, kind: "material" as const, item_id: "i2", description: "مسامير ألواح", colour: null, quantity: 10, unit: "box", unit_price: 35, amount: 350 },
    { seq: 3, kind: "expense" as const, item_id: null, description: "نقل للموقع", colour: null, quantity: 1, unit: "trip", unit_price: 450, amount: 450 },
  ],
};

export const SAMPLE_PURCHASE_FORM: PurchaseForm = {
  purchase: null,
  suppliers: [{ id: "s1", name: "مؤسسة مواد البناء الحديثة", vat_number: "300123456700003" }],
  items,
  projects,
  aiEnabled: true,
  vatRegistered: false,
  products: [
    { id: "pr1", label: "Knauf — لوح جبس عادي 12.5 مم" },
    { id: "pr2", label: "Jotun — Fenomastic دهان جدران" },
  ],
  quoteLists: {
    k0: [
      { description: "لوح جبس عادي — Knauf (2.88)", colour: "", quantity: 150, unit: "pack", unit_price: 22, item: "new", product_id: "pr1", general: true, bought: 60, remaining: 90 },
      { description: "دهان جدران — Jotun (18)", colour: "بيج", quantity: 4, unit: "pack", unit_price: 180, item: "new", product_id: "pr2", general: false, bought: 0, remaining: 4 },
      { description: "فتحات صيانة", colour: "", quantity: 4, unit: "pcs", unit_price: 75, item: "new", product_id: null, general: true, bought: 0, remaining: 4 },
    ],
  },
};
export const SAMPLE_PURCHASE_DETAIL = { ...SAMPLE_PURCHASE_FORM, purchase: detail };

export const SAMPLE_INVENTORY: InventoryData = {
  items,
  projects,
  canManage: true,
  products: [{ id: "pr1", label: "Knauf — لوح جبس عادي 12.5 مم" }],
  balances: [
    { item_id: "i1", contract_id: null, quantity: 120, value: 2640 },
    { item_id: "i1", contract_id: "k0", quantity: 60, value: 1320 },
    { item_id: "i2", contract_id: null, quantity: 6, value: 210 },
    { item_id: "i3", contract_id: "k1", quantity: 4, value: 1800 },
  ],
};

export const SAMPLE_COSTS: ProjectCost[] = [
  { ...projects[0], estimated: 11800, materials: 11950, expenses: 900, subcontractors: 4200, petty: 0, materialsActual: 12850, actual: 22840, pending: 7245, labour: 3240, maintenance: 250, commission: 2300 },
  { ...projects[1], estimated: 7200, materials: 4100, expenses: 0, subcontractors: 0, petty: 0, materialsActual: 4100, actual: 4100, pending: 0, labour: 0 },
];
