-- =============================================================================
-- Subcontractor work follows the project's progress (owner, Nov 2026)
--   The supervisor records progress once on the project page; a subcontractor
--   paid «by progress» gets his work done recorded automatically:
--     overall progress = average of the stages (confirmed = 100 %), same rule
--     as the app (overallProgress in src/lib/execution).
--     per m²  → executed area = agreed area × progress
--     lump    → share of the job = progress
--   Only the missing part is added (manual entries count), never more than the
--   agreement. Automatic rows are marked (`auto`); if the owner edits or deletes
--   one, that agreement stops following progress (`auto_progress = false`) so his
--   correction is never undone.
-- Non-destructive: new columns, functions and triggers.
-- =============================================================================

alter table public.subcontractor_agreements add column auto_progress boolean not null default true;
alter table public.subcontractor_work add column auto boolean not null default false;

-- Only the database writes automatic rows; staff correcting one switches the agreement to manual.
create or replace function private.guard_subcontractor_work_auto()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.auto then
      raise exception 'automatic entries are recorded by the system' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      new.auto := false;
    end if;
  end if;
  return new;
end;
$$;
create trigger subcontractor_work_auto_guard before insert or update on public.subcontractor_work
  for each row execute function private.guard_subcontractor_work_auto();

-- An automatic row edited or deleted (the system never does either) → manual from now on.
create or replace function private.subcontractor_work_corrected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.auto then
    update public.subcontractor_agreements set auto_progress = false where id = old.agreement_id;
  end if;
  return null;
end;
$$;
create trigger subcontractor_work_corrected after update or delete on public.subcontractor_work
  for each row execute function private.subcontractor_work_corrected();

create or replace function private.sync_subcontractor_progress(p_contract uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pct numeric;
  g public.subcontractor_agreements;
  v_done numeric;
  v_delta numeric;
begin
  select round(avg(case when s.status = 'confirmed' then 100 else s.progress end))
  into v_pct
  from public.project_stages s where s.contract_id = p_contract;
  if v_pct is null or v_pct <= 0 then
    return;
  end if;
  for g in select * from public.subcontractor_agreements a
           where a.contract_id = p_contract and a.schedule = 'progress' and a.status = 'active' and a.auto_progress
           order by a.id
           for update loop
    if g.basis = 'per_m2' then
      if coalesce(g.quantity_m2, 0) <= 0 then
        continue;
      end if;
      select coalesce(sum(w.quantity_m2), 0) into v_done from public.subcontractor_work w where w.agreement_id = g.id;
      v_delta := round(least(g.quantity_m2 * v_pct / 100, g.quantity_m2) - v_done, 2);
      if v_delta >= 0.01 then
        insert into public.subcontractor_work (organization_id, agreement_id, work_date, quantity_m2, note, auto, created_by)
        values (g.organization_id, g.id, (now() at time zone 'Asia/Riyadh')::date, v_delta,
                'تلقائي من تقدم المشروع: ' || v_pct || '%', true, auth.uid());
      end if;
    else
      select coalesce(sum(w.percent), 0) into v_done from public.subcontractor_work w where w.agreement_id = g.id;
      v_delta := round(least(v_pct, 100) - v_done, 2);
      if v_delta >= 0.01 then
        insert into public.subcontractor_work (organization_id, agreement_id, work_date, percent, note, auto, created_by)
        values (g.organization_id, g.id, (now() at time zone 'Asia/Riyadh')::date, v_delta,
                'تلقائي من تقدم المشروع: ' || v_pct || '%', true, auth.uid());
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function private.sync_subcontractor_progress(uuid) from public;

create or replace function private.project_stage_subcontractor_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.progress is distinct from old.progress or new.status is distinct from old.status then
    perform private.sync_subcontractor_progress(new.contract_id);
  end if;
  return null;
end;
$$;
create trigger project_stages_subcontractor_progress after update of progress, status on public.project_stages
  for each row execute function private.project_stage_subcontractor_progress();

-- =============================================================================
-- The other direction: an external team added in Schedule is a subcontractor
-- too (found by name, else created) — so he appears under «مقاولو الباطن» and
-- in pricing without being entered again.
-- =============================================================================
create or replace function private.team_to_subcontractor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub uuid;
  v_name text := new.name;
begin
  if new.kind <> 'external' or new.subcontractor_id is not null then
    return null;
  end if;
  select id into v_sub from public.subcontractors s
  where s.organization_id = new.organization_id and s.name = new.name
    and not exists (select 1 from public.teams t where t.subcontractor_id = s.id);
  if v_sub is not null then
    update public.teams set subcontractor_id = v_sub where id = new.id;
    return null;
  end if;
  -- the name may belong to a subcontractor who already has another team
  if exists (select 1 from public.subcontractors x where x.organization_id = new.organization_id and x.name = v_name) then
    v_name := left(new.name, 150) || ' (2)';
  end if;
  -- tell the subcontractor's own trigger to link THIS team instead of creating one
  perform set_config('app.link_team', new.id::text, true);
  insert into public.subcontractors (organization_id, name, services, phone, is_active, created_by)
  values (new.organization_id, v_name, new.services, new.contact_phone, new.is_active, new.created_by)
  on conflict (organization_id, name) do nothing;
  perform set_config('app.link_team', '', true);
  return null;
end;
$$;
create trigger teams_to_subcontractor after insert or update of kind on public.teams
  for each row execute function private.team_to_subcontractor();

-- existing external teams without a subcontractor
update public.teams set kind = kind where kind = 'external' and subcontractor_id is null;

-- Subcontractor → team, now also linking the exact team that asked for it (above).
create or replace function private.sync_subcontractor_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := left(new.name, 80);
  v_link text := nullif(current_setting('app.link_team', true), '');
begin
  if exists (select 1 from public.teams t where t.subcontractor_id = new.id) then
    update public.teams
    set name = case when exists (select 1 from public.teams x where x.organization_id = new.organization_id and x.name = v_name and x.subcontractor_id is distinct from new.id) then name else v_name end,
        services = new.services, contact_phone = new.phone, is_active = new.is_active
    where subcontractor_id = new.id;
  elsif tg_op = 'INSERT' and v_link ~ '^[0-9a-f-]{36}$'
        and exists (select 1 from public.teams t where t.id = v_link::uuid and t.organization_id = new.organization_id and t.subcontractor_id is null) then
    update public.teams
    set subcontractor_id = new.id,
        name = case when exists (select 1 from public.teams x where x.organization_id = new.organization_id and x.name = v_name and x.id <> v_link::uuid) then name else v_name end
    where id = v_link::uuid;
  elsif exists (select 1 from public.teams t where t.organization_id = new.organization_id and t.name = v_name and t.kind = 'external' and t.subcontractor_id is null) then
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

-- Editing a linked team in Schedule updates the subcontractor too (one record, no drift).
create or replace function private.team_edit_to_subcontractor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 or new.subcontractor_id is null then
    return null;
  end if;
  update public.subcontractors s
  set name = case when exists (select 1 from public.subcontractors x where x.organization_id = s.organization_id and x.name = new.name and x.id <> s.id) then s.name else new.name end,
      phone = new.contact_phone, services = new.services, is_active = new.is_active
  where s.id = new.subcontractor_id
    and (s.name is distinct from new.name or s.phone is distinct from new.contact_phone
         or s.services is distinct from new.services or s.is_active is distinct from new.is_active);
  return null;
end;
$$;
create trigger teams_edit_to_subcontractor after update of name, contact_phone, services, is_active on public.teams
  for each row execute function private.team_edit_to_subcontractor();

-- An agreement made mid-project catches up with the progress already recorded.
create or replace function private.agreement_catch_up()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_subcontractor_progress(new.contract_id);
  return null;
end;
$$;
create trigger subcontractor_agreements_catch_up after insert or update of auto_progress, schedule, status, quantity_m2 on public.subcontractor_agreements
  for each row execute function private.agreement_catch_up();
