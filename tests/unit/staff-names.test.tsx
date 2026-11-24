import { describe, expect, it, vi } from "vitest";
import { hrefs, render } from "./helpers/render";
import { MemberSummary } from "@/components/settings/members-view";
import { SAMPLE_MEMBERS } from "@/app/dev/preview/sample";
import { SAMPLE_PETTY } from "@/app/dev/preview/sample-subs";
import { PettyCashView } from "@/components/purchases/sub-petty-views";
import { MaintenanceView } from "@/components/projects/maintenance-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

/** The permissions dialog names the employee linked to the account (owner, Nov 2026). */
describe("MemberSummary (permissions dialog heading)", () => {
  const linked = SAMPLE_MEMBERS.find((m) => m.employee)!;
  it("shows «name · job» of the linked employee, linked to his record only with hr.view", () => {
    const withHr = render(<MemberSummary member={linked} canViewHr base="/dev/preview" />);
    expect(withHr).toContain("محمد القحطاني · مشرف");
    expect(hrefs(withHr)).toEqual(["/dev/preview/team?employee=e2"]);
    const without = render(<MemberSummary member={linked} canViewHr={false} base="" />);
    expect(without).toContain("محمد القحطاني · مشرف");
    expect(hrefs(without)).toEqual([]);
  });
  it("an account without an employee keeps its name and role only", () => {
    const html = render(<MemberSummary member={SAMPLE_MEMBERS.find((m) => !m.employee && m.role === "viewer")!} canViewHr base="" />);
    expect(html).toContain("خالد الدوسري");
    expect(html).not.toContain("team?employee");
  });
});

describe("staff pages show the linked employee's «name · job» from the loader", () => {
  it("petty-cash card: the holder", () => {
    expect(render(<PettyCashView data={SAMPLE_PETTY} />)).toContain("أحمد سالم · مشرف");
  });
  it("maintenance: next to the assignee and in the assignee list", () => {
    const html = render(
      <MaintenanceView
        data={{ canManage: true, warranties: [], members: [{ id: "u1", name: "صالح" }, { id: "u2", name: "محمد القحطاني · مشرف" }], requests: [{ id: "m", number: "MR-2026-001", contract: "C-2026-001", client: "أم خالد", client_phone: null, body: "تقشر", photos: [], source: "client", status: "in_progress", assigned_to: "u2", covered: true, cost: 0, reply: null, internal_note: null, created_at: new Date().toISOString(), resolved_at: null, client_confirmed_at: null }] }}
        focus="MR-2026-001"
        contract={null}
      />,
    );
    expect(html).toContain("محمد القحطاني · مشرف");
  });
});

describe("maintenance: a suspended member keeps his name (review #1)", () => {
  const html = render(
    <MaintenanceView
      data={{ canManage: true, warranties: [], members: [{ id: "u1", name: "صالح" }], names: { u1: "صالح", u2: "محمد القحطاني · مشرف" }, requests: [{ id: "m", number: "MR-2026-001", contract: "C-2026-001", client: "أم خالد", client_phone: null, body: "تقشر", photos: [], source: "client", status: "rejected", assigned_to: "u2", covered: true, cost: 0, reply: null, internal_note: null, created_at: new Date().toISOString(), resolved_at: null, client_confirmed_at: null, closed_at: new Date().toISOString(), closed_by: "u2" }] }}
      focus="MR-2026-001"
      contract={null}
    />,
  );
  it("next to the assignee and in «rejected by»", () => {
    expect(html.match(/محمد القحطاني · مشرف/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("فريق الشركة");
  });
  it("the pick list keeps the current (suspended) assignee so saving doesn't drop him; others are active members", () => {
    expect(html).toMatch(/<option value="u2"[^>]*>محمد القحطاني · مشرف<\/option>/);
    expect(html).toMatch(/<option value="u1"[^>]*>صالح<\/option>/);
  });
});

describe("permissions dialog: an account without a name shows its phone (review #3)", () => {
  it("never «· مشرف» alone", () => {
    const m = { ...SAMPLE_MEMBERS.find((x) => x.employee)!, name: null, employee: null };
    const html = render(<MemberSummary member={m} canViewHr base="" />);
    expect(html).toContain('<bdi dir="ltr">+966 55 123 4567</bdi> · مشرف');
    expect(html).not.toMatch(/<p>\s*· /);
  });
});
