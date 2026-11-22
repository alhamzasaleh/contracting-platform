import { EmployeesView } from "@/components/team/employees-view";
import { SAMPLE_COST_ITEMS, SAMPLE_EMPLOYEES } from "../../sample-catalogue";

export default function P() {
  return <EmployeesView employees={SAMPLE_EMPLOYEES} costItems={SAMPLE_COST_ITEMS} workingDays={26} canManage />;
}
