import { PageHeader } from "@/components/shell/app-shell";
import { MaintenanceView } from "@/components/projects/maintenance-view";
import type { MaintenancePageData } from "@/lib/data/maintenance";
import { previewNoop } from "../../preview-actions";

const ago = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
const inDays = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

const DATA: MaintenancePageData = {
  canManage: true,
  members: [{ id: "u1", name: "صالح العتيبي" }, { id: "u2", name: "محمد القحطاني · مشرف" }],
  names: { u1: "صالح العتيبي", u2: "محمد القحطاني · مشرف" },
  requests: [
    { id: "m1", number: "MR-2026-003", contract: "C-2026-002", client: "أبو فهد", client_phone: "966551112233", body: "ظهر شق بسيط في سقف المجلس جهة الشباك.", photos: [], source: "client", status: "open", assigned_to: null, covered: true, cost: 0, reply: null, internal_note: null, created_at: ago(0.2), resolved_at: null, client_confirmed_at: null },
    { id: "m2", number: "MR-2026-002", contract: "C-2026-001", client: "أم خالد", client_phone: null, body: "تقشر في دهان دورة المياه.", photos: [], source: "client", status: "in_progress", assigned_to: "u2", covered: true, cost: 180, reply: "بنمر الأحد الصبح", internal_note: "رطوبة من السباكة — نتأكد قبل الدهان", created_at: ago(3), resolved_at: null, client_confirmed_at: null },
    { id: "m3", number: "MR-2026-001", contract: "C-2026-001", client: "أم خالد", client_phone: null, body: "باب الصيانة في الممر ما يقفل.", photos: [], source: "staff", status: "closed", assigned_to: "u2", covered: true, cost: 60, reply: "تم تعديل باب الصيانة", internal_note: null, created_at: ago(20), resolved_at: ago(18), client_confirmed_at: ago(17), closed_at: ago(17) },
    { id: "m4", number: "MR-2026-000", contract: "C-2026-002", client: "أبو فهد", client_phone: "966551112233", body: "صوت طقطقة في السقف المعلّق.", photos: [], source: "client", status: "closed", assigned_to: "u2", covered: true, cost: 0, reply: "تمت المعاينة: تمدد حراري طبيعي، لا يحتاج إصلاح", internal_note: null, created_at: ago(30), resolved_at: null, client_confirmed_at: null, closed_at: ago(29), closed_by: "u2" },
    { id: "m5", number: "MR-2026-004", contract: "C-2026-001", client: "أم خالد", client_phone: "966552223344", body: "خدش في دهان الصالة بعد نقل الأثاث.", photos: [], source: "client", status: "rejected", assigned_to: "u1", covered: false, cost: 0, reply: "الخدش من نقل الأثاث وليس عيباً في التنفيذ، ونقدر نصلحه بتكلفة بسيطة.", internal_note: null, created_at: ago(8), resolved_at: null, client_confirmed_at: null, closed_at: ago(7), closed_by: "u1" },
  ],
  warranties: [
    { number: "C-2026-002", client: "أبو فهد", handover_at: ago(40), warranty_end: inDays(140), active: true },
    { number: "C-2026-001", client: "أم خالد", handover_at: ago(90), warranty_end: inDays(90), active: true },
  ],
};

export default function PreviewMaintenance() {
  return (
    <div>
      <PageHeader title="الصيانة والضمان" />
      <MaintenanceView data={DATA} focus={null} base="/dev/preview" actions={{ update: previewNoop, create: previewNoop }} />
    </div>
  );
}
