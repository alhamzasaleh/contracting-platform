import { SAMPLE_LOGO } from "./sample-logo";
import { linesToCatalogue } from "@/lib/catalogue/product-lines";
import type { QuoteDetail, QuoteListItem } from "@/lib/data/quotes";
import { defaultSelection, priceSelection, type PricingContext } from "@/lib/pricing";
import { buildSnapshot } from "@/lib/quotes";
import { surveyQuantities } from "@/lib/survey";
import { SAMPLE_SURVEY } from "./sample-clients";
import { SAMPLE_ENGINE_DATA, SAMPLE_LINES } from "./sample-engine";

/** Illustrative quote built with the real pricing core from the sample survey. */
export const SAMPLE_PRICING_CTX: PricingContext = {
  catalogue: { ...SAMPLE_ENGINE_DATA, products: linesToCatalogue(SAMPLE_LINES) },
  external: [{ id: "00000000-0000-4000-8000-000000000001", name: "مقاول أبو فهد", service: "interior", basis: "external_per_unit", rate: 9 }],
  crew: [],
  vatPercent: 0,
};
export const SAMPLE_QUANTITIES = surveyQuantities("interior", "rooms", SAMPLE_SURVEY.rooms, SAMPLE_SURVEY.survey.totals);
const sel = defaultSelection("interior", SAMPLE_PRICING_CTX.catalogue);
const outcome = priceSelection(sel, SAMPLE_QUANTITIES, SAMPLE_PRICING_CTX);
const snap = buildSnapshot(sel, SAMPLE_QUANTITIES, outcome, { discountPercent: 5, method: "unit", estimated: false, vatPercent: 0, catalogue: SAMPLE_PRICING_CTX.catalogue });

export const SAMPLE_QUOTE: QuoteDetail = {
  quote: { id: "q2", number: "Q-2026-008", service: "interior", status: "pending_approval", version: 2, valid_until: null, created_at: "2026-11-21T11:00:00Z" },
  client: { number: "CL-2026-003", name: "أبو محمد العتيبي", phone: "966551234567", city: "الرياض" },
  survey: { number: "SV-2026-004" },
  current: { version: 2, clientView: snap.clientView, notes: "يبدأ العمل بعد اعتماد الألوان من العميل.", estimated: false, created_at: "2026-11-22T09:00:00Z", quantities: SAMPLE_QUANTITIES },
  versions: [
    { version: 2, total: snap.clientView.total, created_at: "2026-11-22T09:00:00Z" },
    { version: 1, total: snap.clientView.total + 900, created_at: "2026-11-21T11:00:00Z" },
  ],
  internal: { cost: snap.cost, costWithContingency: snap.costWithContingency, marginPercent: snap.marginPercent, lines: snap.lines, purchaseList: snap.purchaseList },
  approvals: [{ id: "a1", kind: "quote_discount", status: "pending", details: { version: 2, discount: snap.clientView.discount, discountPercent: 5 }, decided_at: null, decision_note: null }],
  canManage: true,
  canDecide: true,
  contract: null,
};

export const SAMPLE_QUOTES: QuoteListItem[] = [
  { id: "q2", number: "Q-2026-008", client: "أبو محمد العتيبي", clientNumber: "CL-2026-003", service: "interior", status: "pending_approval", version: 2, total: snap.clientView.total, created_at: "2026-11-21T11:00:00Z" },
  { id: "q1", number: "Q-2026-007", client: "أبو محمد العتيبي", clientNumber: "CL-2026-003", service: "gypsum", status: "issued", version: 2, total: 31840, created_at: "2026-11-21T10:00:00Z" },
];

export const SAMPLE_ORG = { name: "مؤسسة صالح للتشطيبات", legal_name: null, cr_number: "1010123456", vat_number: null, phone: "0551234567", city: "الرياض", address: "حي العليا، طريق الملك فهد", signatory_name: "صالح العتيبي", signatory_title: "المالك", logoUrl: SAMPLE_LOGO };
