/**
 * Notifications (§3.18) — shared types and the WhatsApp text (Arabic, the
 * owner's language). In-app text comes from messages/*.json ("notify" namespace).
 */
import type { NotificationKind } from "@/lib/supabase/database.types";

export const NOTIFICATION_KINDS: NotificationKind[] = [
  "approval", "approval_reminder", "client_note", "stage_confirmed", "contract_accepted", "addendum_accepted", "payment_received", "payment_late", "doc_expiry",
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
    case "doc_expiry":
      return Number(p.days) <= 0 ? `انتهت ${DOC[s("doc")] ?? ""} للموظف ${s("name")}` : `${DOC[s("doc")] ?? ""} للموظف ${s("name")} تنتهي بعد ${s("days")} يوم`;
  }
}
