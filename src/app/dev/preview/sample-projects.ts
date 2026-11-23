import type { ProjectDetail, ProjectListItem } from "@/lib/data/projects";
import type { PortalData } from "@/lib/portal";
import { SAMPLE_PORTAL } from "./sample-contracts";

// Sample photos are tiny inline SVGs (no network, no database).
const ph = (c: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="${c}"/></svg>`)}`;

export const SAMPLE_PROJECTS: ProjectListItem[] = [
  { id: "k0", number: "C-2026-003", client: "شركة البناء المتقن", service: "gypsum", start_date: "2026-11-21", duration_days: 14, progress: 52, stage: "تركيب الألواح", stageStatus: "in_progress", lastVisit: "2026-11-22T07:30:00Z", newNotes: 1, done: false },
  { id: "k2", number: "C-2026-005", client: "فيلا الياسمين", service: "exterior", start_date: "2026-11-01", duration_days: 10, progress: 100, stage: null, stageStatus: null, lastVisit: "2026-11-12T08:10:00Z", newNotes: 0, done: true },
];

const stage = (seq: number, name: string, status: ProjectDetail["stages"][number]["status"], progress: number, extra: Partial<ProjectDetail["stages"][number]> = {}) => ({
  id: `s${seq}`, seq, name, status, progress, is_final: false, payment_event: null, report: null, report_ai: false, sent_at: null,
  confirmed_at: null, confirmed_name: null, signed: false, updates: [], ...extra,
});

export const SAMPLE_PROJECT: ProjectDetail = {
  contract: { id: "k0", number: "C-2026-003", service: "gypsum", start_date: "2026-11-21", duration_days: 14, warranty_months: 6, accepted_at: "2026-11-19T10:00:00Z" },
  client: { name: "شركة البناء المتقن", phone: "966551234567", city: "الرياض", district: "الملقا", location_url: "https://www.google.com/maps/place/x/@24.8031,46.6105,17z" },
  canManage: true,
  canPurchase: true,
  canViewContract: true,
  aiEnabled: true,
  stages: [
    stage(1, "تجهيز الموقع وتحديد المناسيب", "confirmed", 100, { confirmed_at: "2026-11-21T15:00:00Z", confirmed_name: "م. خالد", report: "تم تجهيز الموقع وتحديد المناسيب في جميع الغرف." }),
    stage(2, "تركيب الهيكل المعدني", "awaiting_client", 100, { report: "اكتمل تركيب الهيكل المعدني للأسقف في الدور الأرضي والأول وفق المخطط.", sent_at: "2026-11-22T12:00:00Z" }),
    stage(3, "تركيب الألواح", "in_progress", 60, {
      payment_event: "board_closing",
      updates: [{ id: "u1", progress: 60, note: "تم تقفيل ألواح الصالة والمجلس، والغرف العلوية بكرة.", photos: [{ path: "a", url: ph("#c9bfae") }, { path: "b", url: ph("#9aa79f") }], created_at: "2026-11-22T13:00:00Z", visible: true }],
    }),
    stage(4, "معالجة الفواصل والمعجون", "pending", 0),
    stage(5, "التنظيف والتسليم", "pending", 0, { is_final: true, payment_event: "handover" }),
  ],
  visits: [
    { id: "v1", checked_in_at: "2026-11-22T07:30:00Z", latitude: 24.8032, longitude: 46.6107, accuracy_m: 9, note: null, by: "صالح العتيبي" },
    { id: "v2", checked_in_at: "2026-11-21T07:10:00Z", latitude: null, longitude: null, accuracy_m: null, note: null, by: "صالح العتيبي" },
  ],
  notes: [{ id: "n1", body: "نبي فتحة التكييف في المجلس أكبر شوي لو سمحتوا.", photos: [{ path: "c", url: ph("#b8b1a3") }], status: "new", reply: null, stage_id: "s3", created_at: "2026-11-22T16:00:00Z" }],
  payments: [
    { seq: 1, label: "عند توقيع العقد", amount: 12000, due_event: "signing", status: "paid" },
    { seq: 2, label: "بعد تقفيل الألواح", amount: 9000, due_event: "board_closing", status: "pending" },
    { seq: 3, label: "عند التسليم النهائي", amount: 9000, due_event: "handover", status: "pending" },
  ],
  addenda: [{ number: "AD-2026-001", title: "بيت إنارة إضافي في المجلس", total: 1800, payment_status: "requested", extra_days: 3 }],
  dates: { start: "2026-11-21", delivery: "2026-12-07", extraDays: 3, warrantyEnd: null },
  cost: { estimated: 8100, materials: 5200, actual: 6420 },
  bookTeam: "t1",
  openMaintenance: 0,
  canSchedule: true,
};

export const SAMPLE_PORTAL_WORK: PortalData = {
  ...SAMPLE_PORTAL,
  contract: { ...SAMPLE_PORTAL.contract, status: "accepted", accepted_at: "2026-11-19T10:00:00Z", accepted_name: "أبو محمد" },
  warranty: {
    handover_at: "2026-11-20T10:00:00Z", warranty_end: "2027-05-20", active: true,
    requests: [{ id: "mr1", number: "MR-2026-001", body: "شق بسيط فوق باب المجلس.", photos: [], status: "resolved", reply: "تمت المعالجة وإعادة الدهان.", created_at: "2026-11-21T09:00:00Z", resolved_at: "2026-11-22T15:00:00Z", client_confirmed_at: null }],
  },
  invoiceDocs: [{ id: "iv1", number: "INV-2026-001", kind: "simple", issue_date: "2026-11-20", due_date: "2026-11-20", description: "عند توقيع العقد", seller: { name: "مؤسسة ملمس" }, buyer: { name: "أبو محمد" }, subtotal: 18400, vat_percent: 0, vat: 0, total: 18400, paid: 18400, official: "p1", has_official: false }],
  receipts: [{ number: "RV-2026-007", label: "عند توقيع العقد", amount: 18400, paid_on: "2026-11-20", method: "transfer", reference: null, created_at: "2026-11-20T09:00:00Z" }],
  execution: {
    stages: SAMPLE_PROJECT.stages.map((s) => ({
      id: s.id, seq: s.seq, name: s.name, status: s.status, progress: s.progress, is_final: s.is_final,
      report: s.status === "awaiting_client" || s.status === "confirmed" ? s.report : null, sent_at: s.sent_at, confirmed_at: s.confirmed_at, confirmed_name: s.confirmed_name,
      photos: s.updates.flatMap((u) => u.photos.map((p) => p.url!)),
    })),
    notes: [{ id: "n1", body: "نبي فتحة التكييف في المجلس أكبر شوي لو سمحتوا.", photos: [], status: "resolved", reply: "أكيد، تم توسيعها اليوم.", stage_id: "s3", created_at: "2026-11-22T16:00:00Z" }],
  },
  addenda: [
    { id: "ad3", number: "AD-2026-003", title: "دهان سقف الملحق", description: "معجون وجهين ودهان وجهين لسقف الملحق الخارجي 35 م²، بنفس مواصفات العقد.", amount: 1400, vat_percent: 0, vat: 0, total: 1400, extra_days: 2, status: "sent", payment_status: "pending", accepted_at: null, accepted_name: null },
  ],
};
