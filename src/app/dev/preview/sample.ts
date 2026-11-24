import { SAMPLE_COMPACT_LOGO, SAMPLE_LOGO } from "./sample-logo";
import type { AuditItem } from "@/components/settings/audit-view";
import type { InvitationItem, MemberItem } from "@/components/settings/members-view";
import type { ShellData } from "@/components/shell/types";
import { effectivePermissions, PERMISSIONS } from "@/lib/auth/permissions";

/** Sample data for the design preview. No real data, no database access. */
export const SAMPLE_ORG = {
  name: "مؤسسة صالح للتشطيبات",
  legal_name: "مؤسسة صالح للمقاولات العامة",
  cr_number: "1010123456",
  vat_number: null,
  phone: "966112345678",
  email: "info@example.com",
  city: "الرياض",
  address: "حي العليا، طريق الملك فهد",
  signatory_name: "صالح العتيبي",
  signatory_title: "المالك",
  brand: { primary: "#B5653E", accent: "#D9CBB5", source: "default" as const },
};

export const SAMPLE_SHELL: ShellData = {
  user: { name: "صالح العتيبي", phone: "966500000001" },
  org: { name: SAMPLE_ORG.name, logoUrl: SAMPLE_LOGO, compactLogoUrl: SAMPLE_COMPACT_LOGO },
  role: "owner",
  permissions: [...PERMISSIONS],
  notifications: {
    canDecide: true,
    unread: 3,
    items: [
      { id: "n1", kind: "approval", params: { approval_id: "a1", kind: "quote_discount", number: `Q-${new Date().getFullYear()}-014` }, link: "/", read: false, created_at: new Date(Date.now() - 12 * 60_000).toISOString() },
      { id: "n2", kind: "client_note", params: { number: `C-${new Date().getFullYear()}-007`, body: "نبغى نغير لون غرفة النوم الرئيسية للون أفتح" }, link: "/projects/C-2026-007", read: false, created_at: new Date(Date.now() - 95 * 60_000).toISOString() },
      { id: "n3", kind: "payment_late", params: { number: `C-${new Date().getFullYear()}-003`, label: "بعد توريد المواد", amount: 18400, days: 14 }, link: "/reports", read: false, created_at: new Date(Date.now() - 5 * 3600_000).toISOString() },
      { id: "n4", kind: "stage_confirmed", params: { number: `C-${new Date().getFullYear()}-005`, stage: "إغلاق الألواح", final: false }, link: "/projects/C-2026-005", read: true, created_at: new Date(Date.now() - 26 * 3600_000).toISOString() },
      { id: "n5", kind: "doc_expiry", params: { name: "رفيق أحمد", doc: "id", days: 30 }, link: "/team/payroll", read: true, created_at: new Date(Date.now() - 50 * 3600_000).toISOString() },
    ],
  },
  assistant: { ready: true },
  basePath: "/dev/preview",
};

export const SAMPLE_MEMBERS: MemberItem[] = [
  { id: "1", userId: "u1", name: "صالح العتيبي", phone: "966500000001", role: "owner", status: "active", permissions: effectivePermissions("owner"), isYou: true },
  { id: "2", userId: "u2", name: "محمد القحطاني", phone: "966551234567", role: "supervisor", status: "active", permissions: effectivePermissions("supervisor"), isYou: false, employee: { id: "e2", name: "محمد القحطاني", job: "مشرف" } },
  { id: "3", userId: "u3", name: "نورة الشمري", phone: "966541112233", role: "finance", status: "active", permissions: effectivePermissions("finance"), isYou: false, suggestEmployee: { id: "e4", name: "نورة الشمري", job: "محاسبة" } },
  { id: "4", userId: "u4", name: "خالد الدوسري", phone: "966532221100", role: "viewer", status: "suspended", permissions: effectivePermissions("viewer"), isYou: false },
];

export const SAMPLE_INVITES: InvitationItem[] = [
  { id: "i1", phone: "966599887766", name: "عبدالله الحربي", role: "supervisor", expiresAt: new Date(Date.now() + 9 * 864e5).toISOString() },
  { id: "i2", phone: "966537000003", name: "أنور حسين", role: "viewer", expiresAt: new Date(Date.now() + 12 * 864e5).toISOString(), employee: { id: "e3", name: "أنور حسين", job: "فني جبس" } },
];

const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
export const SAMPLE_AUDIT: AuditItem[] = [
  { id: 6, at: ago(4), actor: "صالح العتيبي", action: "update", table: "organizations", changes: [{ field: "vat_number", before: null, after: "310000000000003" }] },
  { id: 5, at: ago(38), actor: "صالح العتيبي", action: "insert", table: "member_invitations", changes: [{ field: "role", before: null, after: "supervisor" }, { field: "phone", before: null, after: "966599887766" }] },
  { id: 4, at: ago(60 * 5), actor: "صالح العتيبي", action: "update", table: "memberships", changes: [{ field: "status", before: "active", after: "suspended" }] },
  { id: 3, at: ago(60 * 26), actor: "صالح العتيبي", action: "update", table: "organizations", changes: [{ field: "brand", before: { primary: "#1E4D4A" }, after: { primary: "#1E4D4A", accent: "#4F6F66" } }] },
  { id: 2, at: ago(60 * 50), actor: null, action: "insert", table: "memberships", changes: [{ field: "role", before: null, after: "owner" }] },
];
