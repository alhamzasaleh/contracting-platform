-- =============================================================================
-- One subcontractor, three places (owner, Nov 2026): a subcontractor is entered
-- once and appears in
--   • Purchases → «مقاولو الباطن» (the master record: work done, payments)
--   • Pricing → «العمالة والمصاريف» (labour_rates: price per m² / lump sum)
--   • Schedule → teams (an external team to book on projects)
-- Links: labour_rates.subcontractor_id, teams.subcontractor_id (one team each).
-- Triggers keep them together; nothing is deleted. Existing external labour
-- rates (e.g. «سفيان») get their subcontractor and team now.
-- =============================================================================

alter table public.labour_rates add column subcontractor_id uuid references public.subcontractors (id) on delete set null;
alter table public.teams add column subcontractor_id uuid unique references public.subcontractors (id) on delete set null;
create index labour_rates_sub_idx on public.labour_rates (subcontractor_id);

-- a service code → the work kinds used by teams/subcontractors
create or replace function private.service_kind(p_service uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.code like 'gypsum%' then 'gypsum' when s.code like 'interior%' then 'interior' when s.code like 'exterior%' then 'exterior' end
  from public.services s where s.id = p_service
$$;
revoke all on function private.service_kind(uuid) from public;

-- Subcontractor → its external team (created once, kept in step: name, services, phone, active).
create or replace function private.sync_subcontractor_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := left(new.name, 80);
begin
  if exists (select 1 from public.teams t where t.subcontractor_id = new.id) then
    update public.teams
    set name = case when exists (select 1 from public.teams x where x.organization_id = new.organization_id and x.name = v_name and x.subcontractor_id is distinct from new.id) then name else v_name end,
        services = new.services, contact_phone = new.phone, is_active = new.is_active
    where subcontractor_id = new.id;
  elsif exists (select 1 from public.teams t where t.organization_id = new.organization_id and t.name = v_name and t.kind = 'external' and t.subcontractor_id is null) then
    -- an external team with the same name already exists: link it
    update public.teams set subcontractor_id = new.id, services = new.services, contact_phone = coalesce(contact_phone, new.phone)
    where organization_id = new.organization_id and name = v_name and kind = 'external' and subcontractor_id is null;
  else
    insert into public.teams (organization_id, name, kind, services, contact_phone, is_active, subcontractor_id, color, created_by)
    values (new.organization_id,
            case when exists (select 1 from public.teams x where x.organization_id = new.organization_id and x.name = v_name) then left(v_name, 70) || ' (مقاول)' else v_name end,
            'external', new.services, new.phone, new.is_active, new.id, '#B5653E', new.created_by);
  end if;
  return null;
end;
$$;
create trigger subcontractors_team after insert or update of name, services, phone, is_active on public.subcontractors
  for each row execute function private.sync_subcontractor_team();

-- External labour rate without a subcontractor → find (by name) or create one, and link it.
create or replace function private.link_labour_rate_subcontractor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub uuid;
  v_kind text := private.service_kind(new.service_id);
begin
  if new.subcontractor_id is not null then
    if not exists (select 1 from public.subcontractors s where s.id = new.subcontractor_id and s.organization_id = new.organization_id) then
      raise exception 'subcontractor of another organization' using errcode = '42501';
    end if;
  else
    select id into v_sub from public.subcontractors where organization_id = new.organization_id and name = new.name;
    if v_sub is null then
      insert into public.subcontractors (organization_id, name, services, created_by)
      values (new.organization_id, new.name, case when v_kind is null then '{}'::text[] else array[v_kind] end, new.created_by)
      returning id into v_sub;
    end if;
    new.subcontractor_id := v_sub;
  end if;
  -- the subcontractor (and its team) does the rate's kind of work
  if v_kind is not null then
    update public.subcontractors set services = array(select distinct unnest(services || array[v_kind]))
    where id = new.subcontractor_id and not (v_kind = any (services));
  end if;
  return new;
end;
$$;
create trigger labour_rates_subcontractor before insert or update of name, service_id, subcontractor_id on public.labour_rates
  for each row execute function private.link_labour_rate_subcontractor();

-- A team can only point at a subcontractor of its own organization.
create or replace function private.check_team_subcontractor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.subcontractor_id is not null
     and not exists (select 1 from public.subcontractors s where s.id = new.subcontractor_id and s.organization_id = new.organization_id) then
    raise exception 'subcontractor of another organization' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger teams_subcontractor_check before insert or update of subcontractor_id on public.teams
  for each row execute function private.check_team_subcontractor();

-- Existing data: every subcontractor gets its team; every labour rate its subcontractor.
update public.labour_rates set subcontractor_id = null where subcontractor_id is null;  -- fires the link trigger
update public.subcontractors set name = name;  -- fires the team trigger for older rows
