import { describe, expect, it, vi } from "vitest";
import { employeeSchema } from "@/lib/hr/employee-schema";
import { phoneTakenBy } from "@/lib/hr/access";
import { EmployeesView } from "@/components/team/employees-view";
import { SAMPLE_COST_ITEMS, SAMPLE_EMPLOYEES } from "@/app/dev/preview/sample-catalogue";
import { render } from "./helpers/render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {} }), usePathname: () => "/team", useSearchParams: () => new URLSearchParams() }));

/* The employee's phone is required (owner, Nov 2026: «لازم رقم جواله»). */
const base = { full_name: "سالم الدهان", is_saudi: false, nationality: "", job_title: "", id_number: "", id_expiry: "", passport_expiry: "", insurance_expiry: "", start_date: "", basic_salary: "0", housing_allowance: "0", transport_allowance: "0", other_allowances: "0", iban: "", status: "active", notes: "" };

describe("employee phone required", () => {
  it("the form refuses an empty phone (required), a wrong one (invalid), and takes a Saudi mobile", () => {
    const empty = employeeSchema.safeParse({ ...base, phone: "" });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues.find((i) => i.path[0] === "phone")?.message).toBe("required");
    expect(employeeSchema.safeParse({ ...base, phone: "12" }).error?.issues.find((i) => i.path[0] === "phone")?.message).toBe("phoneInvalid");
    const ok = employeeSchema.safeParse({ ...base, phone: "0537000111" });
    expect(ok.success && ok.data.phone).toBe("966537000111");
  });
  it("an older employee without a phone: «add his phone first» instead of an invitation that would be refused", () => {
    const html = render(
      <EmployeesView
        employees={[{ ...SAMPLE_EMPLOYEES[0], id: "x1", user_id: null, phone: null, status: "active" }]}
        costItems={SAMPLE_COST_ITEMS}
        workingDays={26}
        canManage
        access={{ members: [], invites: [], isOwner: true }}
      />,
    );
    expect(html).toContain("أضف جواله أولاً");
    expect(html).not.toContain("اعطه دخول للنظام");
  });
  it("who can give access but not edit employees reads why, instead of a dead button", () => {
    const html = render(
      <EmployeesView
        employees={[{ ...SAMPLE_EMPLOYEES[0], id: "x1", user_id: null, phone: null, status: "active" }]}
        costItems={SAMPLE_COST_ITEMS}
        workingDays={26}
        canManage={false}
        access={{ members: [], invites: [], isOwner: false }}
      />,
    );
    expect(html).toContain("ما له جوال مسجّل");
    expect(html).not.toContain("أضف جواله أولاً");
  });
  it("a number already on another employee is said (warn, don't block)", () => {
    const list = [{ id: "a", full_name: "سالم", phone: "966537000111" }, { id: "b", full_name: "ماجد", phone: null }];
    expect(phoneTakenBy("0537000111", list, "b")?.full_name).toBe("سالم");
    expect(phoneTakenBy("0537000111", list, "a")).toBeNull();
    expect(phoneTakenBy("05370001", list)).toBeNull();
    expect(phoneTakenBy("", list)).toBeNull();
  });
});
