-- =============================================================================
-- Phase 5 — Scheduling
--   teams (in-house crews or external contractors) with the services they do,
--   team_members (employees in a crew), schedule_entries (a team booked on a
--   contract, or unavailable for leave / other, between two dates).
--   Projects themselves come from contracts (start_date + duration_days).
--   Read: schedule.view · write: schedule.manage. Employee names for the
--   schedule come through public.schedule_roster() (name + job only — never
--   salaries or documents, which stay behind hr.view).
-- =============================================================================

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  kind text not null default 'inhouse' check (kind in ('inhouse', 'external')),
  services text[] not null default '{}' check (services <@ array['gypsum', 'interior', 'exterior']::text[]),
  color text not null default '#1E4D4A' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  contact_phone text check (contact_phone ~ '^[0-9]{8,15}$'),
  is_active boolean not null default true,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
create index teams_org_idx on public.teams (organization_id, is_active);

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (team_id, employee_id)
);
create index team_members_team_idx on public.team_members (team_id);

create table public.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  contract_id uuid references public.contracts (id) on delete cascade,
  kind text not null default 'work' check (kind in ('work', 'leave', 'other')),
  title text check (char_length(title) <= 160),
  start_date date not null,
  end_date date not null,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date <= 730),
  check (kind <> 'work' or contract_id is not null)
);
create index schedule_entries_org_idx on public.schedule_entries (organization_id, start_date);
create index schedule_entries_team_idx on public.schedule_entries (team_id, start_date);

-- Triggers ------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['teams', 'schedule_entries'] loop
    execute format('create trigger %1$s_updated_at before update on public.%1$s for each row execute function private.set_updated_at()', t);
  end loop;
  foreach t in array array['teams', 'team_members', 'schedule_entries'] loop
    execute format('create trigger %1$s_created_by before insert on public.%1$s for each row execute function private.set_created_by()', t);
    execute format('select private.enable_audit(%L)', 'public.' || t);
  end loop;
end $$;

-- Every reference must stay inside the same organization.
create or replace function private.check_phase5_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  j jsonb := to_jsonb(new);
  ref record;
  v_org uuid;
begin
  for ref in select * from (values ('team_id', 'teams'), ('employee_id', 'employees'), ('contract_id', 'contracts')) as r(col, tbl) loop
    if j ? ref.col and j ->> ref.col is not null then
      execute format('select organization_id from public.%I where id = $1', ref.tbl) into v_org using (j ->> ref.col)::uuid;
      if v_org is distinct from new.organization_id then
        raise exception '% belongs to another organization', ref.col using errcode = '42501';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.check_phase5_refs() from public;
grant execute on function private.check_phase5_refs() to authenticated, service_role;
do $$
declare t text;
begin
  foreach t in array array['teams', 'team_members', 'schedule_entries'] loop
    execute format('create trigger %1$s_refs before insert or update on public.%1$s for each row execute function private.check_phase5_refs()', t);
  end loop;
end $$;

-- RLS -----------------------------------------------------------------------------
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.schedule_entries enable row level security;

do $$
declare t text;
begin
  foreach t in array array['teams', 'team_members', 'schedule_entries'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using ((select private.has_permission(organization_id, 'schedule.view')));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check ((select private.has_permission(organization_id, 'schedule.manage')));
      create policy %1$s_update on public.%1$s for update to authenticated
        using ((select private.has_permission(organization_id, 'schedule.manage')))
        with check ((select private.has_permission(organization_id, 'schedule.manage')));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using ((select private.has_permission(organization_id, 'schedule.manage')));
    $f$, t);
  end loop;
end $$;

revoke all on public.teams, public.team_members, public.schedule_entries from anon;
grant select, insert, update, delete on public.teams, public.team_members, public.schedule_entries to authenticated;
grant all on public.teams, public.team_members, public.schedule_entries to service_role;

-- Names for the schedule (purpose-bound, PDPL): active employees' name and job only.
create or replace function public.schedule_roster(p_org uuid)
returns table (id uuid, full_name text, job_title text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.full_name, e.job_title
  from public.employees e
  where e.organization_id = p_org
    and e.status <> 'final_exit'
    and private.has_permission(p_org, 'schedule.view')
  order by e.full_name;
$$;
revoke all on function public.schedule_roster(uuid) from public, anon;
grant execute on function public.schedule_roster(uuid) to authenticated, service_role;
