/**
 * Employee ↔ sign-in account (pure). An employee gets access through an invitation that carries
 * his employee_id; the database links employees.user_id when the invitation is accepted.
 */
import { normalizeSaudiMobile } from "@/lib/validation/phone";

export type InviteRole = "supervisor" | "finance" | "viewer";
type MemberRole = "owner" | InviteRole;

/** The role suggested from the job title (the owner can change it in the dialog). */
export function suggestRole(jobTitle: string | null | undefined, opts: { canInviteFinance?: boolean } = {}): InviteRole {
  const j = (jobTitle ?? "").toLowerCase();
  if (/مشرف|supervisor/.test(j)) return "supervisor";
  if (/مالي|محاسب|finance|account/.test(j)) return opts.canInviteFinance === false ? "viewer" : "finance";
  return "viewer";
}

export type EmployeeAccess =
  | { kind: "member"; role: MemberRole }
  | { kind: "suspended"; role: MemberRole }
  /** left the company (final exit) but his account is still active — suspend it */
  | { kind: "exitActive"; role: MemberRole }
  | { kind: "pending"; invitationId: string; role: InviteRole }
  /** linked to an account that is no longer a member — unlink, then invite again */
  | { kind: "linkedNoMember" }
  /** his number is already a member's account — link them instead of inviting */
  | { kind: "memberSamePhone"; userId: string; role: MemberRole }
  | { kind: "none" };

export type AccessMember = { userId: string; role: MemberRole; status: "active" | "suspended"; phone?: string | null };
export type AccessInvite = { id: string; employeeId: string | null; role: InviteRole; phone: string };

/**
 * One state per employee. `linkedUsers` = accounts already linked to some employee (a member
 * linked elsewhere is never offered again).
 */
export function employeeAccess(
  employee: { id: string; user_id?: string | null; status?: string; phone?: string | null },
  members: AccessMember[],
  invites: AccessInvite[],
  linkedUsers: Set<string> = new Set(),
): EmployeeAccess {
  if (employee.user_id) {
    const m = members.find((x) => x.userId === employee.user_id);
    if (!m) return { kind: "linkedNoMember" };
    if (m.status === "suspended") return { kind: "suspended", role: m.role };
    if (employee.status === "final_exit") return { kind: "exitActive", role: m.role };
    return { kind: "member", role: m.role };
  }
  const inv = invites.find((i) => i.employeeId === employee.id);
  if (inv) return { kind: "pending", invitationId: inv.id, role: inv.role };
  const same = employee.phone ? members.find((m) => m.phone === employee.phone && !linkedUsers.has(m.userId)) : undefined;
  if (same) return { kind: "memberSamePhone", userId: same.userId, role: same.role };
  return { kind: "none" };
}

export type LinkableEmployee = { employee_id: string; full_name: string; job_title: string | null; phone: string | null; user_id: string | null; status?: string };

/** The employee without access whose number is the one typed (any Saudi form), else null. */
export function matchEmployee<T extends LinkableEmployee>(typed: string, employees: T[]): T | null {
  const phone = normalizeSaudiMobile(typed);
  if (!phone) return null;
  return employees.find((e) => !e.user_id && e.phone === phone) ?? null;
}

/** A refused invitation (database error) → the error key the dialogs show. */
export function inviteError(error: { code?: string; message?: string }): string {
  const m = error.message ?? "";
  if (m.includes("employee already has access")) return "employeeLinked";
  if (m.includes("already a member")) return "alreadyMember";
  if (m.includes("linked to another employee")) return "memberLinkedElsewhere";
  if (m.includes("is not the employee's phone")) return "notEmployeePhone";
  if (error.code === "23505") return "duplicate";
  if (error.code === "42501") return "noAccess";
  return "error";
}

/** The home setup step «ادعُ فريقك»: done once someone else is a member or invited; with employees still without access it leads to /team. */
export function teamSetupStep(c: { members: number; pendingInvites: number; employeesWithoutAccess: number }): { done: boolean; href: string } {
  return { done: c.members > 1 || c.pendingInvites > 0, href: c.employeesWithoutAccess > 0 ? "/team" : "/settings/members" };
}
