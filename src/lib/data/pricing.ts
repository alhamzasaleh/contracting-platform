import "server-only";
import { can, type SessionContext } from "@/lib/auth/session";
import { effectiveVatPercent, employeeCost } from "@/lib/costing";
import { loadPricingSettings } from "@/lib/data/catalogue";
import { loadEngineData } from "@/lib/data/engine";
import { loadCostItems } from "@/lib/data/team";
import type { CrewMember, ExternalLabour, PricingContext, Selection, ServiceKind } from "@/lib/pricing";
import { createClient } from "@/lib/supabase/server";

const SERVICE_OF: Record<string, ServiceKind> = { gypsum: "gypsum", "interior-paint": "interior", "exterior-paint": "exterior" };

/** Everything the pricing screen needs: materials, labour options and saved templates. */
export async function loadPricingContext(session: SessionContext): Promise<{
  ctx: PricingContext;
  templates: Partial<Record<ServiceKind, Partial<Selection>>>;
  canSeeCrewCost: boolean;
}> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const seeHr = can(session, "hr.view");
  const [catalogue, settings, { data: rates }, { data: services }, { data: templates }, employees, costItems, { data: teamRows }, { data: memberRows }] = await Promise.all([
    loadEngineData(session),
    loadPricingSettings(session),
    supabase.from("labour_rates").select("id, name, basis, rate, service_id, is_active").eq("organization_id", orgId).eq("is_active", true).order("name"),
    supabase.from("services").select("id, code").eq("organization_id", orgId),
    supabase.from("pricing_templates").select("service, data").eq("organization_id", orgId),
    seeHr
      ? supabase.from("employees").select("id, full_name, job_title, is_saudi, basic_salary, housing_allowance, transport_allowance, other_allowances, status").eq("organization_id", orgId).eq("status", "active").order("full_name")
      : Promise.resolve({ data: [] as never[] }),
    seeHr ? loadCostItems(session) : Promise.resolve([]),
    seeHr
      ? supabase.from("teams").select("id, name").eq("organization_id", orgId).eq("kind", "inhouse").eq("is_active", true).order("name")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    seeHr ? supabase.from("team_members").select("team_id, employee_id").eq("organization_id", orgId) : Promise.resolve({ data: [] as { team_id: string; employee_id: string }[] }),
  ]);
  const serviceCode = new Map((services ?? []).map((s) => [s.id, s.code]));
  const workingDays = Number(settings?.working_days_per_month ?? 26);

  const external: ExternalLabour[] = (rates ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    service: r.service_id ? (SERVICE_OF[serviceCode.get(r.service_id) ?? ""] ?? null) : null,
    basis: r.basis,
    rate: Number(r.rate),
  }));
  const crew: CrewMember[] = (employees.data ?? []).map((e) => ({
    id: e.id,
    name: e.full_name,
    job: e.job_title,
    perDay: employeeCost(
      {
        is_saudi: e.is_saudi,
        basic_salary: Number(e.basic_salary ?? 0),
        housing_allowance: Number(e.housing_allowance ?? 0),
        transport_allowance: Number(e.transport_allowance ?? 0),
        other_allowances: Number(e.other_allowances ?? 0),
      },
      costItems,
      workingDays,
    ).perDay,
  }));

  return {
    ctx: {
      catalogue,
      external,
      crew,
      teams: (teamRows ?? [])
        .map((t) => ({ id: t.id, name: t.name, members: (memberRows ?? []).filter((m) => m.team_id === t.id).map((m) => m.employee_id).filter((id) => crew.some((c) => c.id === id)) }))
        .filter((t) => t.members.length > 0),
      vatPercent: effectiveVatPercent(session.organization.vat_number, Number(settings?.vat_percent ?? 15)),
    },
    templates: Object.fromEntries((templates ?? []).map((t) => [t.service, t.data as Partial<Selection>])),
    canSeeCrewCost: seeHr,
  };
}
