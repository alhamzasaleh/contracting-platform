/**
 * Notifications (§3.18) — shared types and the WhatsApp text (Arabic, the
 * owner's language). In-app text comes from messages/*.json ("notify" namespace).
 */
import type { NotificationKind } from "@/lib/supabase/database.types";

export const NOTIFICATION_KINDS: NotificationKind[] = [
  "approval", "approval_reminder", "client_note", "stage_confirmed", "contract_accepted", "addendum_accepted", "payment_received", "payment_late", "doc_expiry", "maintenance_request",
  "project_delay", "project_over_budget", "project_losing", "missed_visit", "agreement_review",
  "quote_accepted", "quote_changes_requested", "quote_rejected", "commission_due", "measurement_approved", "measurement_objected", "measurement_waiting", "measurement_credit", "commission_overpaid",
];

export type NotificationItem = { id: string; kind: NotificationKind; params: Record<string, unknown>; link: string | null; read: boolean; created_at: string };

const DOC: Record<string, string> = { id: "الإقامة/الهوية", passport: "الجواز", insurance: "التأمين الطبي" };
const money = (v: unknown) => (typeof v === "number" || typeof v === "string" ? `${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })} ر.س` : "");

/** One plain line for a WhatsApp template body parameter. */
export function whatsappText(kind: NotificationKind, p: Record<string, unknown>): string {
  const s = (k: string) => (p[k] == null ? "" : String(p[k]));
  switch (kind) {
    case "approval":
      return `طلب موافقة جديد ${s("number")}`.trim();
    case "approval_reminder":
      return `تذكير: طلب موافقة ما زال ينتظرك ${s("number")}`.trim();
    case "client_note":
      return `ملاحظة جديدة من العميل على ${s("number")}: ${s("body")}`;
    case "stage_confirmed":
      return p.final ? `العميل وقّع الاستلام النهائي لـ ${s("number")}` : `العميل أكّد استلام مرحلة «${s("stage")}» في ${s("number")}`;
    case "contract_accepted":
      return `وافق العميل على العقد ${s("number")}`;
    case "addendum_accepted":
      return `وافق العميل على الملحق ${s("number")} (${s("title")})`;
    case "payment_received":
      return `استلمنا ${money(p.amount)} — ${s("label")} (${s("number")})`;
    case "payment_late":
      return `دفعة متأخرة ${s("days")} يوم: ${s("label")} (${s("number")}) — المتبقي ${money(p.amount)}`;
    case "maintenance_request":
      return `طلب صيانة جديد ${s("number")} على ${s("contract")}: ${s("body")}`;
    case "project_delay":
      return `المشروع ${s("number")} (${s("client")}) متأخر ${s("days")} يوم عن موعد التسليم`;
    case "project_over_budget":
      return `مواد المشروع ${s("number")} (${s("client")}) تجاوزت التقدير بـ ${s("percent")}%`;
    case "project_losing":
      return Number(p.profit) < 0
        ? `المشروع ${s("number")} (${s("client")}) يخسر — الربح الفعلي ${money(p.profit)}`
        : `ربح المشروع ${s("number")} (${s("client")}) أقل من نصف المتوقع — الفعلي ${money(p.profit)}`;
    case "agreement_review":
      if (s("addendum").startsWith("MS-")) return `العميل وقّع كشف القياس ${s("addendum")} على ${s("number")} — راجع كمية اتفاقيات مقاولي الباطن بالمتر (${s("count")})`;
      return `الملحق ${s("addendum")} على ${s("number")} مقبول — راجع كمية وسعر اتفاقيات مقاولي الباطن (${s("count")})`;
    case "quote_accepted":
      return `وافق العميل ${s("name")} على عرض السعر ${s("number")}`;
    case "quote_changes_requested":
      return `العميل طلب تعديل على عرض السعر ${s("number")}: ${s("note")}`;
    case "quote_rejected":
      return `العميل اعتذر عن عرض السعر ${s("number")}${s("note") ? `: ${s("note")}` : ""}`;
    case "commission_due":
      return `مكافأة شريك النجاح ${s("marketer")} مستحقة الصرف — ${money(p.amount)} (${s("number")})`;
    case "measurement_approved":
      return `العميل وقّع كشف القياس ${s("measurement")} على ${s("number")} — الفرق ${money(p.amount)}`;
    case "measurement_objected":
      return `العميل اعترض على كشف القياس ${s("measurement")} على ${s("number")}`;
    case "commission_overpaid":
      return `انصرف لشريك النجاح ${s("marketer")} أكثر من مكافأته بعد تسوية الأمتار بـ ${money(p.amount)} (${s("number")})`;
    case "measurement_waiting":
      return `كشف القياس ${s("measurement")} على ${s("number")} ينتظر رد العميل من ${s("days")} أيام`;
    case "measurement_credit":
      return `مبلغ مستحق للعميل ${money(p.amount)} من كشف القياس ${s("measurement")} على ${s("number")} — سجّل صرفه`;
    case "missed_visit":
      return `ما فيه زيارة موقع للمشروع ${s("number")} (${s("client")}) من ${s("days")} أيام`;
    case "doc_expiry":
      return Number(p.days) <= 0 ? `انتهت ${DOC[s("doc")] ?? ""} للموظف ${s("name")}` : `${DOC[s("doc")] ?? ""} للموظف ${s("name")} تنتهي بعد ${s("days")} يوم`;
  }
}

/** Messages to clients (receipt issued, maintenance done) — plain Arabic, no links (the client opens their own page). */
export function clientMessageText(kind: "receipt" | "maintenance_done", p: Record<string, unknown>): string {
  const s = (k: string) => (p[k] == null ? "" : String(p[k]));
  if (kind === "receipt") {
    return `مرحباً ${s("name")}، استلمنا ${money(p.amount)} — ${s("label")} (عقد ${s("contract")}). سند القبض رقم ${s("number")} متاح في صفحة مشروعك. شكراً لك.`;
  }
  return `مرحباً ${s("name")}، تم إنجاز طلب الصيانة ${s("number")}${s("reply") ? `: ${s("reply")}` : ""}. فضلاً أكّد الاستلام من صفحة مشروعك.`;
}
