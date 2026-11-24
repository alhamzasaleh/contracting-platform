import { describe, expect, it } from "vitest";
import { employeeAccess, inviteError, matchEmployee, staffName, staffNames, suggestRole } from "@/lib/hr/access";

describe("suggestRole: from the job title, editable in the dialog", () => {
  it("supervisor / finance / everything else → viewer", () => {
    expect(suggestRole("مشرف")).toBe("supervisor");
    expect(suggestRole("مشرف موقع")).toBe("supervisor");
    expect(suggestRole("Site supervisor")).toBe("supervisor");
    expect(suggestRole("محاسب")).toBe("finance");
    expect(suggestRole("مالية")).toBe("finance");
    expect(suggestRole("Finance officer")).toBe("finance");
    expect(suggestRole("accountant")).toBe("finance");
    expect(suggestRole("دهان")).toBe("viewer");
    expect(suggestRole(null)).toBe("viewer");
  });
  it("finance is offered only to the owner, else viewer", () => {
    expect(suggestRole("محاسب", { canInviteFinance: false })).toBe("viewer");
  });
});

describe("employeeAccess: one state per employee", () => {
  const members = [{ userId: "u1", role: "supervisor" as const, status: "active" as const }];
  const invites = [{ id: "i1", employeeId: "e2", role: "viewer" as const, phone: "966500000002" }];
  it("linked → member with his role; pending invitation; or none", () => {
    expect(employeeAccess({ id: "e1", user_id: "u1" }, members, invites)).toEqual({ kind: "member", role: "supervisor" });
    expect(employeeAccess({ id: "e2", user_id: null }, members, invites)).toEqual({ kind: "pending", invitationId: "i1", role: "viewer" });
    expect(employeeAccess({ id: "e3", user_id: null }, members, invites)).toEqual({ kind: "none" });
  });
  it("a linked account that is no longer a member reads as none (can be invited again only after unlinking)", () => {
    expect(employeeAccess({ id: "e1", user_id: "gone" }, members, invites)).toEqual({ kind: "linkedNoMember" });
  });
});

describe("matchEmployee: a typed number that belongs to an employee without access", () => {
  const employees = [
    { employee_id: "e1", full_name: "احمد", job_title: "مشرف", phone: "966537087857", user_id: null },
    { employee_id: "e2", full_name: "سالم", job_title: null, phone: "966537000002", user_id: "u2" },
  ];
  it("matches any Saudi form of the number, never an employee who already has access", () => {
    expect(matchEmployee("0537087857", employees)?.employee_id).toBe("e1");
    expect(matchEmployee("+966 53 708 7857", employees)?.employee_id).toBe("e1");
    expect(matchEmployee("0537000002", employees)).toBeNull();
    expect(matchEmployee("05", employees)).toBeNull();
  });
});

describe("inviteError", () => {
  it("names the refusals", () => {
    expect(inviteError({ code: "22023", message: "employee already has access" })).toBe("employeeLinked");
    expect(inviteError({ code: "23505", message: "duplicate key" })).toBe("duplicate");
    expect(inviteError({ code: "42501", message: "the employee belongs to another organization" })).toBe("noAccess");
    expect(inviteError({ code: "XX000", message: "?" })).toBe("error");
  });
});

describe("review: access states and refusals", () => {
  const members = [
    { userId: "u1", role: "supervisor" as const, status: "active" as const, phone: "966500000001" },
    { userId: "u2", role: "viewer" as const, status: "suspended" as const, phone: "966500000002" },
    { userId: "u3", role: "viewer" as const, status: "active" as const, phone: "966500000003" },
  ];
  it("a suspended account is «suspended», never «has access»", () => {
    expect(employeeAccess({ id: "e", user_id: "u2", status: "active" }, members, [])).toEqual({ kind: "suspended", role: "viewer" });
  });
  it("final exit with an active account asks to suspend it", () => {
    expect(employeeAccess({ id: "e", user_id: "u1", status: "final_exit" }, members, [])).toEqual({ kind: "exitActive", role: "supervisor" });
  });
  it("an unlinked employee whose number is a member's account → link him, not invite", () => {
    expect(employeeAccess({ id: "e", user_id: null, phone: "966500000003" }, members, [], new Set())).toEqual({ kind: "memberSamePhone", userId: "u3", role: "viewer" });
    // that member is already another employee's account → plain none (the database refuses both)
    expect(employeeAccess({ id: "e", user_id: null, phone: "966500000003" }, members, [], new Set(["u3"]))).toEqual({ kind: "none" });
  });
  it("names the new refusals", () => {
    expect(inviteError({ code: "22023", message: "this number is already a member" })).toBe("alreadyMember");
    expect(inviteError({ code: "22023", message: "this number is a member linked to another employee" })).toBe("memberLinkedElsewhere");
    expect(inviteError({ code: "22023", message: "the invitation number is not the employee's phone" })).toBe("notEmployeePhone");
    expect(inviteError({ code: "22023", message: "the member's phone is not the employee's phone" })).toBe("notEmployeePhone");
  });
});

describe("home «ادعُ فريقك»", () => {
  it("a pending invitation counts as progress; employees without access lead to /team", async () => {
    const { teamSetupStep } = await import("@/lib/hr/access");
    expect(teamSetupStep({ members: 1, pendingInvites: 0, employeesWithoutAccess: 0 })).toEqual({ done: false, href: "/settings/members" });
    expect(teamSetupStep({ members: 1, pendingInvites: 1, employeesWithoutAccess: 0 })).toEqual({ done: true, href: "/settings/members" });
    expect(teamSetupStep({ members: 2, pendingInvites: 0, employeesWithoutAccess: 0 }).done).toBe(true);
    expect(teamSetupStep({ members: 1, pendingInvites: 0, employeesWithoutAccess: 1 })).toEqual({ done: false, href: "/team" });
  });
});

describe("staffName: an account's name on staff pages (maintenance assignee, petty-cash holder)", () => {
  it("linked → «employee name · job»; without a job → the employee's name", () => {
    expect(staffName({ id: "u1", full_name: "حساب", phone: "966500000001" }, { user_id: "u1", full_name: "احمد سالم", job_title: "مشرف" })).toBe("احمد سالم · مشرف");
    expect(staffName({ id: "u1", full_name: "حساب", phone: null }, { user_id: "u1", full_name: "احمد سالم", job_title: null })).toBe("احمد سالم");
  });
  it("not linked → his current name, else the local phone, else —", () => {
    expect(staffName({ id: "u2", full_name: "سالم", phone: "966500000002" })).toBe("سالم");
    expect(staffName({ id: "u2", full_name: null, phone: "966500000002" })).toBe("0500000002");
    expect(staffName(undefined)).toBe("—");
  });
  it("staffNames maps every account id, the linked ones from the employee record", () => {
    const m = staffNames(
      [
        { id: "u1", full_name: "حساب", phone: null },
        { id: "u2", full_name: "سالم", phone: null },
      ],
      [{ user_id: "u1", full_name: "احمد", job_title: "دهان" }],
    );
    expect(m.get("u1")).toBe("احمد · دهان");
    expect(m.get("u2")).toBe("سالم");
  });
});
