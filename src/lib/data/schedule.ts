import "server-only";
import { can, type SessionContext } from "@/lib/auth/session";
import type { ServiceKind } from "@/lib/pricing";
import { addDays, projectDates, type Entry, type TeamInfo } from "@/lib/schedule";
import type { ContractStatus } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type ScheduleTeam = TeamInfo & { kind: "inhouse" | "external"; color: string; contact_phone: string | null; notes: string | null; members: string[]; subcontractor_id?: string | null };
export type ScheduleEntry = Entry & { id: string; kind: "work" | "leave" | "other"; title: string | null; notes: string | null };
/** `end` = the last work day (the bar's last day); `delivery` = the delivery date (the day after, as on the contract page) */
export type ScheduleProject = { id: string; number: string; client: string; service: ServiceKind; status: ContractStatus; start: string; end: string; delivery: string; days: number };

export type ScheduleData = {
  teams: ScheduleTeam[];
  roster: { id: string; full_name: string; job_title: string | null }[];
  entries: ScheduleEntry[];
  projects: ScheduleProject[];
  canManage: boolean;
};

/** Teams, bookings and active projects (contracts) for the schedule. */
export async function loadSchedule(session: SessionContext): Promise<ScheduleData> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const since = addDays(new Date().toISOString().slice(0, 10), -120);
  const seeProjects = can(session, "quotes.view");
  const [{ data: teams }, { data: members }, { data: entries }, { data: roster }, contracts, clients] = await Promise.all([
    supabase.from("teams").select("id, name, kind, services, color, contact_phone, is_active, notes, subcontractor_id").eq("organization_id", orgId).order("name"),
    supabase.from("team_members").select("team_id, employee_id").eq("organization_id", orgId),
    supabase.from("schedule_entries").select("id, team_id, contract_id, kind, title, start_date, end_date, notes").eq("organization_id", orgId).gte("end_date", since).order("start_date"),
    supabase.rpc("schedule_roster", { p_org: orgId }),
    seeProjects
      ? supabase.from("contracts").select("id, number, client_id, service, status, start_date, duration_days").eq("organization_id", orgId).neq("status", "cancelled").order("start_date")
      : Promise.resolve({ data: [] as never[] }),
    seeProjects ? supabase.from("clients").select("id, name").eq("organization_id", orgId) : Promise.resolve({ data: [] as never[] }),
  ]);
  // accepted additional works extend the delivery date
  const { data: addenda } = seeProjects ? await supabase.from("addenda").select("contract_id, extra_days").eq("organization_id", orgId).eq("status", "accepted") : { data: [] };
  const extra = new Map<string, number>();
  for (const a of addenda ?? []) extra.set(a.contract_id, (extra.get(a.contract_id) ?? 0) + a.extra_days);
  const byTeam = new Map<string, string[]>();
  for (const m of members ?? []) byTeam.set(m.team_id, [...(byTeam.get(m.team_id) ?? []), m.employee_id]);
  const clientName = new Map(((clients.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  return {
    teams: (teams ?? []).map((t) => ({ ...t, members: byTeam.get(t.id) ?? [] })),
    roster: (roster ?? []) as ScheduleData["roster"],
    entries: (entries ?? []).map((e) => ({ id: e.id, team_id: e.team_id, contract_id: e.contract_id, kind: e.kind, title: e.title, notes: e.notes, start: e.start_date, end: e.end_date })),
    projects: ((contracts.data ?? []) as { id: string; number: string; client_id: string; service: ServiceKind; status: ContractStatus; start_date: string; duration_days: number }[])
      .map((c) => {
        const days = c.duration_days + (extra.get(c.id) ?? 0);
        const { lastWorkDay, delivery } = projectDates(c.start_date, days);
        return { id: c.id, number: c.number, client: clientName.get(c.client_id) ?? "—", service: c.service, status: c.status, start: c.start_date, days, end: lastWorkDay, delivery };
      })
      .filter((p) => p.end >= since),
    canManage: can(session, "schedule.manage"),
  };
}

/** Light version for the contract editor: teams and bookings only. */
export async function loadBusy(session: SessionContext): Promise<{ teams: TeamInfo[]; entries: Entry[] } | null> {
  if (!can(session, "schedule.view")) return null;
  const supabase = await createClient();
  const orgId = session.organization.id;
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: teams }, { data: entries }] = await Promise.all([
    supabase.from("teams").select("id, name, services, is_active").eq("organization_id", orgId),
    supabase.from("schedule_entries").select("id, team_id, contract_id, kind, start_date, end_date").eq("organization_id", orgId).gte("end_date", today),
  ]);
  return {
    teams: teams ?? [],
    entries: (entries ?? []).map((e) => ({ id: e.id, team_id: e.team_id, contract_id: e.contract_id, kind: e.kind, start: e.start_date, end: e.end_date })),
  };
}
