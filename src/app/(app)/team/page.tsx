import { EmployeesView } from "@/components/team/employees-view";
import { can, getSession } from "@/lib/auth/session";
import { loadPricingSettings } from "@/lib/data/catalogue";
import { loadCostItems } from "@/lib/data/team";
import { createClient } from "@/lib/supabase/server";
import { saveEmployee } from "./actions";

export default async function TeamPage() {
  const session = await getSession();
  const supabase = await createClient();
  const [{ data: employees }, costItems, settings] = await Promise.all([
    supabase.from("employees").select("*").eq("organization_id", session.organization.id).order("status").order("full_name"),
    loadCostItems(session),
    loadPricingSettings(session),
  ]);
  const num = (v: unknown) => Number(v ?? 0);
  return (
    <EmployeesView
      employees={(employees ?? []).map((e) => ({
        ...e,
        basic_salary: num(e.basic_salary),
        housing_allowance: num(e.housing_allowance),
        transport_allowance: num(e.transport_allowance),
        other_allowances: num(e.other_allowances),
      }))}
      costItems={costItems}
      workingDays={Number(settings?.working_days_per_month ?? 26)}
      canManage={can(session, "hr.manage")}
      onSave={saveEmployee}
    />
  );
}
