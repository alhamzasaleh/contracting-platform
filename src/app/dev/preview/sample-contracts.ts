import type { ContractDetail, ContractDraft, ContractListItem } from "@/lib/data/contracts";
import type { PortalData } from "@/lib/portal";
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
  client: { ...SAMPLE_QUOTE.client, district: "النرجس", id_number: "1012345678" },
  quote: { number: SAMPLE_QUOTE.quote.number, version: 2, date: "2026-11-22T09:00:00Z", valid_until: "2026-11-29", view, notes: SAMPLE_QUOTE.current!.notes },
  payments: SAMPLE_PAYMENTS,
  link: { active: true, expires_at: "2027-07-10T00:00:00Z", last_opened_at: "2026-11-22T18:00:00Z", open_count: 3 },
  materialCost: 7200,
  canManage: true,
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
  org: { name: "مؤسسة صالح للتشطيبات", legal_name: null, cr_number: "1010123456", vat_number: null, phone: "966551234567", city: "الرياض", address: "حي العليا، طريق الملك فهد", signatory_name: "صالح العتيبي", signatory_title: "المالك", logo_path: null, brand: { primary: "#1E4D4A", accent: "#4F6F66" } },
  client: { name: SAMPLE_QUOTE.client.name, phone: SAMPLE_QUOTE.client.phone, city: SAMPLE_QUOTE.client.city, district: "النرجس", id_number: "1012345678" },
  contract: { ...SAMPLE_CONTRACT.contract },
  quote: { number: SAMPLE_QUOTE.quote.number, version: 2, date: "2026-11-22T09:00:00Z", valid_until: "2026-11-29", client_view: view, notes: SAMPLE_QUOTE.current!.notes },
  payments: SAMPLE_PAYMENTS,
  expires_at: "2027-07-10T00:00:00Z",
};
