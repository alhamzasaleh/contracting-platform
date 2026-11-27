import { EmployeesView } from "@/components/team/employees-view";
import { previewNoop } from "../../preview-actions";
import { SAMPLE_COST_ITEMS, SAMPLE_EMPLOYEES } from "../../sample-catalogue";

// access states: محمد linked (supervisor), أنور invitation pending, رحيم without access, سعيد saved before
// the phone became required («أضف جواله أولاً»)
export default function P() {
  return (
    <EmployeesView
      employees={[...SAMPLE_EMPLOYEES, { ...SAMPLE_EMPLOYEES[0], id: "e4", full_name: "سعيد علي", phone: null }]}
      costItems={SAMPLE_COST_ITEMS}
      workingDays={26}
      canManage
      onSave={previewNoop}
      access={{
        members: [{ userId: "u2", role: "supervisor", status: "active" }],
        invites: [{ id: "i2", employeeId: "e3", role: "viewer", phone: "966537000003" }],
        isOwner: true,
        invite: previewNoop,
        revoke: previewNoop,
        link: previewNoop,
        unlink: previewNoop,
        base: "/dev/preview",
      }}
      focus="e2"
    />
  );
}
