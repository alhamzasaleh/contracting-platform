import type { ContractDetail, ContractDraft, ContractListItem } from "@/lib/data/contracts";
import type { PortalData, PortalQuoteData } from "@/lib/portal";
import { scheduleAmounts } from "@/lib/contracts";
import { SAMPLE_QUOTE } from "./sample-quotes";

/** Illustrative contract and client page for the design preview only. */
const view = SAMPLE_QUOTE.current!.clientView;
const total = view.total;
const pct = [40, 30, 20, 10];
const amounts = scheduleAmounts(total, pct);
const labels = ["عند توقيع العقد", "بعد توريد المواد", "بعد الأساس", "عند التسليم النهائي"];
const events = ["signing", "material_supply", "primer_done", "handover"] as const;
export const SAMPLE_PAYMENTS = pct.map((p, i) => ({ seq: i + 1, label: labels[i], percent: p, amount: amounts[i], due_event: events[i], status: "pending" }));

export const SAMPLE_CONTRACT: ContractDetail = {
  contract: {
    id: "k1", number: "C-2026-004", status: "sent", service: "interior", project_type: "full", start_date: "2026-12-01", duration_days: 9,
    warranty_months: 6, total, notes: null, created_at: "2026-11-22T12:00:00Z", accepted_at: null, accepted_name: null, accepted_ip: null, accepted_user_agent: null, signed: false,
  },
  // the client lives in العليا; the project is at its survey's own site (النرجس)
  client: { ...SAMPLE_QUOTE.client, district: "العليا", id_number: "1012345678" },
  quote: { number: SAMPLE_QUOTE.quote.number, version: 2, date: "2026-11-22T09:00:00Z", valid_until: "2026-11-29", view, notes: SAMPLE_QUOTE.current!.notes },
  payments: SAMPLE_PAYMENTS,
  link: { active: true, expires_at: "2027-07-10T00:00:00Z", last_opened_at: "2026-11-22T18:00:00Z", open_count: 3 },
  materialCost: 7200,
  reward: { id: "k3", marketer: "سعد بن فهد الدوسري", percent: 5, amount: 2300, status: "paid", voucher: "PV-2026-001", canOpenPartners: true, canOpenVoucher: true },
  canManage: true,
  canPurchase: true,
  canViewProject: true,
  canDecide: true,
  canFinance: true,
  canCosts: true,
  vatPercent: 0,
  options: null,
  receipts: [{ number: "RV-2026-007", label: "عند توقيع العقد", amount: amounts[0], paid_on: "2026-11-23" }],
  invoices: [
    { number: "INV-2026-004", label: "عند توقيع العقد", amount: amounts[0], paid_on: "2026-11-19" },
    { number: "INV-2026-006", label: "AD-2026-001 — بيت إنارة إضافي في المجلس", amount: 1800, paid_on: "2026-11-22" },
  ],
  openMaintenance: 0,
  addenda: [
    { id: "ad1", number: "AD-2026-001", title: "بيت إنارة إضافي في المجلس", description: "تنفيذ بيت إنارة بطول 12 م مع شادو، بنفس مواصفات العقد.", amount: 1800, vat: 0, total: 1800, extra_days: 3, status: "accepted", payment_status: "requested", accepted_at: "2026-11-22T10:00:00Z", accepted_name: "أبو محمد", approval_id: null, created_at: "2026-11-21T10:00:00Z", paid_amount: 800, cost: { material: 650, other: 300 } },
    { id: "ad2", number: "AD-2026-002", title: "دهان سقف الملحق", description: "معجون وجهين ودهان وجهين لسقف الملحق الخارجي 35 م².", amount: 1400, vat: 0, total: 1400, extra_days: 2, status: "pending_approval", payment_status: "pending", accepted_at: null, accepted_name: null, approval_id: "ap9", created_at: "2026-11-22T10:00:00Z" },
  ],
};

export const SAMPLE_CONTRACT_DRAFT: ContractDraft = {
  quote: { id: "q2", number: SAMPLE_QUOTE.quote.number, service: "interior", version: 2, total, projectType: "full" },
  client: { name: SAMPLE_QUOTE.client.name },
  contract: null,
  payments: [],
  stages: ["signing", "material_supply", "primer_done", "handover"],
  suggestedDays: 9,
  defaultWarranty: 6,
  materialCost: 7200,
};

export const SAMPLE_CONTRACTS: ContractListItem[] = [
  { id: "k1", number: "C-2026-004", client: SAMPLE_QUOTE.client.name, service: "interior", status: "sent", total, start_date: "2026-12-01", created_at: "2026-11-22T12:00:00Z" },
  { id: "k0", number: "C-2026-003", client: "شركة البناء المتقن", service: "gypsum", status: "accepted", total: 31840, start_date: "2026-11-25", created_at: "2026-11-18T12:00:00Z" },
];

export const SAMPLE_PORTAL: PortalData = {
  org: { name: "مؤسسة صالح للتشطيبات", legal_name: null, cr_number: "1010123456", vat_number: null, phone: "966551234567", city: "الرياض", address: "حي العليا، طريق الملك فهد", signatory_name: "صالح العتيبي", signatory_title: "المالك", logo_path: null, brand: { primary: "#B5653E", accent: "#D9CBB5" } },
  client: { name: SAMPLE_QUOTE.client.name, phone: SAMPLE_QUOTE.client.phone, city: SAMPLE_QUOTE.client.city, district: "العليا", id_number: "1012345678", site_own: true, site_city: "الرياض", site_district: "النرجس" },
  contract: { ...SAMPLE_CONTRACT.contract },
  quote: { number: SAMPLE_QUOTE.quote.number, version: 2, date: "2026-11-22T09:00:00Z", valid_until: "2026-11-29", client_view: view, notes: SAMPLE_QUOTE.current!.notes },
  payments: SAMPLE_PAYMENTS,
  expires_at: "2027-07-10T00:00:00Z",
};

/** The same client page offered with three options (brands) — the client picks one. */
const optionView = (factor: number, brand: string) => ({
  ...view,
  total: Math.round(view.total * factor),
  subtotal: Math.round(view.subtotal * factor),
  net: Math.round(view.net * factor),
  workTypes: view.workTypes.map((w) => ({ ...w, pricePerM2: Math.ceil(w.pricePerM2 * factor), total: Math.round(w.total * factor) })),
  included: view.included.map((i) => ({ ...i, brand: i.brand ? brand : null })),
});
export const SAMPLE_PORTAL_OPTIONS: PortalData = {
  ...SAMPLE_PORTAL,
  options: [
    { version: 2, label: "جوتن", subtotal: Math.round(total), vat: 0, total: Math.round(total), date: "2026-11-22T09:00:00Z", notes: null, client_view: optionView(1, "Jotun") },
    { version: 3, label: "الجزيرة", subtotal: Math.round(total * 0.9), vat: 0, total: Math.round(total * 0.9), date: "2026-11-22T09:10:00Z", notes: null, client_view: optionView(0.9, "Al-Jazeera") },
    { version: 4, label: "عسيب", subtotal: Math.round(total * 0.82), vat: 0, total: Math.round(total * 0.82), date: "2026-11-22T09:20:00Z", notes: null, client_view: optionView(0.82, "Asib") },
  ],
};

/**
 * The client page on the quote (one link for every stage): the offer with three options,
 * before the client answers. Variants below: after a change request, accepted (waiting for
 * the contract), declined.
 */
export const SAMPLE_QUOTE_STAGE: PortalQuoteData = {
  stage: "quote",
  org: SAMPLE_PORTAL.org,
  client: SAMPLE_PORTAL.client,
  quote: {
    number: "Q-2026-007", status: "issued", service: "interior", version: 2, date: "2026-11-22T09:00:00Z", valid_until: "2027-12-31",
    total: Math.round(total), client_view: view, notes: SAMPLE_QUOTE.current!.notes, warranty_months: 6,
    decision: null, decided_at: null, decided_name: null, decision_note: null, chosen_version: null,
  },
  options: SAMPLE_PORTAL_OPTIONS.options!,
  contract: null,
  expires_at: "2028-01-31T21:00:00Z",
};
export const SAMPLE_QUOTE_STAGE_CHANGES: PortalQuoteData = {
  ...SAMPLE_QUOTE_STAGE,
  options: [],
  quote: { ...SAMPLE_QUOTE_STAGE.quote, decision: "changes_requested", decided_at: "2026-11-23T10:15:00Z", decision_note: "نبي لون الصالة أفتح، ونشيل دهان السقف في المجلس." },
};
export const SAMPLE_QUOTE_STAGE_ACCEPTED: PortalQuoteData = {
  ...SAMPLE_QUOTE_STAGE,
  quote: { ...SAMPLE_QUOTE_STAGE.quote, decision: "accepted", decided_at: "2026-11-23T18:40:00Z", decided_name: SAMPLE_PORTAL.client.name, chosen_version: 3 },
};
export const SAMPLE_QUOTE_STAGE_REJECTED: PortalQuoteData = {
  ...SAMPLE_QUOTE_STAGE,
  options: [],
  quote: { ...SAMPLE_QUOTE_STAGE.quote, status: "rejected", decision: "rejected", decided_at: "2026-11-23T18:40:00Z", decision_note: "السعر أعلى من الميزانية." },
};
export const SAMPLE_QUOTE_STAGE_EXPIRED: PortalQuoteData = {
  ...SAMPLE_QUOTE_STAGE,
  options: [],
  quote: { ...SAMPLE_QUOTE_STAGE.quote, valid_until: "2026-11-01" },
};
/** a new version is being prepared: nothing of it reaches the client */
export const SAMPLE_QUOTE_STAGE_REVISING: PortalQuoteData = {
  ...SAMPLE_QUOTE_STAGE,
  options: [],
  quote: { ...SAMPLE_QUOTE_STAGE.quote, status: "draft", version: null, date: null, total: null, client_view: null, notes: null },
};
/** a contract made from the quote (verbal agreement) is being prepared */
export const SAMPLE_QUOTE_STAGE_CONTRACT_DRAFT: PortalQuoteData = {
  ...SAMPLE_QUOTE_STAGE,
  options: [],
  contract: { number: "C-2026-004", status: "draft" },
};
export const SAMPLE_CONTRACT_DRAFT_ACCEPTED: ContractDraft = {
  ...SAMPLE_CONTRACT_DRAFT,
  quoteAccepted: { at: "2026-11-23T18:40:00Z", name: SAMPLE_QUOTE.client.name, label: "الجزيرة" },
};
