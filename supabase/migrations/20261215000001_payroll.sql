-- =============================================================================
-- Phase 9b — Monthly payroll, payslips, advances (§3.20)
--   payroll_runs (one per month): draft → approved → paid.
--   payroll_lines: a snapshot of each employee's salary for the month +
--     overtime, deductions and advances; net is computed by the database.
--   employee_advances: money given ahead; deducted by the run that approves it.
--   Everything is hr.view / hr.manage (salaries are private, PDPL).
-- =============================================================================

create table public.employee_advances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete restrict,
  given_on date not null default current_date,
  amount numeric(12, 2) not null check (amount > 0),
  note text check (char_length(note) <= 300),
  deducted_in_run uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index employee_advances_emp_idx on public.employee_advances (employee_id) where deducted_in_run is null;

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  status text not null default 'draft' check (status in ('draft', 'approved', 'paid')),
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  paid_on date,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, month)
);

alter table public.employee_advances
  add constraint employee_advances_run_fk foreign key (deducted_in_run) references public.payroll_runs (id) on delete set null;

create table public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  run_id uuid not null references public.payroll_runs (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete restrict,
  full_name text not null,
  iban text,
  basic numeric(12, 2) not null default 0 check (basic >= 0),
  housing numeric(12, 2) not null default 0 check (housing >= 0),
  transport numeric(12, 2) not null default 0 check (transport >= 0),
  other numeric(12, 2) not null default 0 check (other >= 0),
  overtime numeric(12, 2) not null default 0 check (overtime >= 0),
  deductions numeric(12, 2) not null default 0 check (deductions >= 0),
  advances numeric(12, 2) not null default 0 check (advances >= 0),
  net numeric(12, 2) not null default 0,
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (run_id, employee_id)
);

-- Triggers ------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['payroll_runs', 'payroll_lines'] loop
    execute format('create trigger %1$s_updated_at before update on public.%1$s for each row execute function private.set_updated_at()', t);
  end loop;
  foreach t in array array['employee_advances', 'payroll_runs', 'payroll_lines'] loop
    execute format('create trigger %1$s_created_by before insert on public.%1$s for each row execute function private.set_created_by()', t);
    execute format('select private.enable_audit(%L)', 'public.' || t);
  end loop;
end $$;

create or replace function private.check_payroll_refs()
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
  for ref in select * from (values ('employee_id', 'employees'), ('run_id', 'payroll_runs')) as r(col, tbl) loop
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
revoke all on function private.check_payroll_refs() from public;
grant execute on function private.check_payroll_refs() to authenticated, service_role;
create trigger employee_advances_refs before insert or update on public.employee_advances for each row execute function private.check_payroll_refs();
create trigger payroll_lines_refs before insert or update on public.payroll_lines for each row execute function private.check_payroll_refs();

-- Net pay is always computed here; lines change only while the run is a draft.
-- security invoker: the checks below must see the real caller (a definer function would always be the owner)
create or replace function private.payroll_line_net()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.payroll_runs where id = coalesce(new.run_id, old.run_id);
  if v_status <> 'draft' and current_user in ('authenticated', 'anon') then
    raise exception 'an approved payroll can''t change' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and current_user in ('authenticated', 'anon') and (
     new.employee_id is distinct from old.employee_id or new.run_id is distinct from old.run_id
     or new.basic is distinct from old.basic or new.housing is distinct from old.housing
     or new.transport is distinct from old.transport or new.other is distinct from old.other) then
    raise exception 'salary components come from the employee record' using errcode = '42501';
  end if;
  new.net := round(new.basic + new.housing + new.transport + new.other + new.overtime - new.deductions - new.advances, 2);
  return new;
end;
$$;
create trigger payroll_lines_net before insert or update or delete on public.payroll_lines for each row execute function private.payroll_line_net();

create or replace function private.guard_payroll_run()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.status <> 'draft' then
      raise exception 'status changes go through the payroll functions' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.status is distinct from old.status or new.approved_at is distinct from old.approved_at or new.month is distinct from old.month) then
      raise exception 'status changes go through the payroll functions' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger payroll_runs_guard before insert or update on public.payroll_runs for each row execute function private.guard_payroll_run();

-- Start a month: one line per active / on-leave employee, salary snapshot + open advances.
create or replace function public.create_payroll_run(p_org uuid, p_month date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run uuid;
  v_month date := date_trunc('month', p_month)::date;
begin
  if not private.has_permission(p_org, 'hr.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select id into v_run from public.payroll_runs where organization_id = p_org and month = v_month;
  if v_run is not null then
    return v_run;
  end if;
  insert into public.payroll_runs (organization_id, month) values (p_org, v_month) returning id into v_run;
  insert into public.payroll_lines (organization_id, run_id, employee_id, full_name, iban, basic, housing, transport, other, advances)
  select p_org, v_run, e.id, e.full_name, e.iban, e.basic_salary, e.housing_allowance, e.transport_allowance, e.other_allowances,
         coalesce((select sum(a.amount) from public.employee_advances a where a.employee_id = e.id and a.deducted_in_run is null), 0)
  from public.employees e
  where e.organization_id = p_org and e.status in ('active', 'on_leave');
  return v_run;
end;
$$;
revoke all on function public.create_payroll_run(uuid, date) from public, anon;
grant execute on function public.create_payroll_run(uuid, date) to authenticated, service_role;

-- Approve: lock the month and settle the advances it deducts.
create or replace function public.approve_payroll_run(p_run uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.id is null or not private.has_permission(r.organization_id, 'hr.manage') or not private.has_permission(r.organization_id, 'approvals.decide') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if r.status <> 'draft' then
    raise exception 'already approved' using errcode = '22023';
  end if;
  update public.employee_advances a set deducted_in_run = r.id
  where a.deducted_in_run is null and a.organization_id = r.organization_id
    and exists (select 1 from public.payroll_lines l where l.run_id = r.id and l.employee_id = a.employee_id and l.advances > 0);
  update public.payroll_runs set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = r.id;
end;
$$;
revoke all on function public.approve_payroll_run(uuid) from public, anon;
grant execute on function public.approve_payroll_run(uuid) to authenticated, service_role;

create or replace function public.mark_payroll_paid(p_run uuid, p_paid_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.id is null or not (private.has_permission(r.organization_id, 'hr.manage') or private.has_permission(r.organization_id, 'finance.manage')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if r.status <> 'approved' or p_paid_on is null or p_paid_on > current_date + 1 then
    raise exception 'approve the payroll first' using errcode = '22023';
  end if;
  update public.payroll_runs set status = 'paid', paid_on = p_paid_on where id = r.id;
end;
$$;
revoke all on function public.mark_payroll_paid(uuid, date) from public, anon;
grant execute on function public.mark_payroll_paid(uuid, date) to authenticated, service_role;

-- RLS -----------------------------------------------------------------------------
alter table public.employee_advances enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_lines enable row level security;

do $$
declare t text;
begin
  foreach t in array array['employee_advances', 'payroll_runs', 'payroll_lines'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using ((select private.has_permission(organization_id, 'hr.view')));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check ((select private.has_permission(organization_id, 'hr.manage')));
      create policy %1$s_update on public.%1$s for update to authenticated
        using ((select private.has_permission(organization_id, 'hr.manage')))
        with check ((select private.has_permission(organization_id, 'hr.manage')));
    $f$, t);
  end loop;
end $$;
create policy employee_advances_delete on public.employee_advances for delete to authenticated
  using ((select private.has_permission(organization_id, 'hr.manage')) and deducted_in_run is null);

revoke all on public.employee_advances, public.payroll_runs, public.payroll_lines from anon;
grant select, insert, update, delete on public.employee_advances to authenticated;
grant select, insert, update on public.payroll_runs, public.payroll_lines to authenticated;
grant all on public.employee_advances, public.payroll_runs, public.payroll_lines to service_role;
