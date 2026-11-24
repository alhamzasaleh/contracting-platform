-- Employee ↔ sign-in account (owner, Nov 2026: «زر في ملف الموظف»). Additive only.
--
-- * member_invitations.employee_id: an invitation may be made FOR an employee (same organization).
-- * employees.user_id: the employee's account, set ONLY by the database when that invitation is
--   accepted (accept_pending_invitations, in the same transaction). Users never write it.
-- * public.member_employee_links(org): names / jobs / phones of employees for the members page
--   (members.manage) — no salaries or documents (hr data stays behind hr.view).

alter table public.member_invitations
  add column if not exists employee_id uuid references public.employees (id) on delete set null;
alter table public.employees
  add column if not exists user_id uuid references auth.users (id) on delete set null;

create unique index if not exists employees_user_uq
  on public.employees (organization_id, user_id) where user_id is not null;
create unique index if not exists member_invitations_employee_pending_uq
  on public.member_invitations (employee_id)
  where employee_id is not null and accepted_at is null and revoked_at is null;
create index if not exists member_invitations_employee_idx on public.member_invitations (employee_id);

-- Every new / changed invitation (SECURITY DEFINER: the inviter may hold members.manage without
-- hr.view, and auth.users is not readable). Runs after member_invitations_guard ("link" > "guard"),
-- so the phone is already normalized.
--  * expired invitations for the same number or employee are revoked first (they would otherwise
--    hold the unique indexes for ever while the pages no longer show them);
--  * a number that already belongs to a member of the organization is refused (change his role on
--    the members page instead) — with its own message when that member is another employee's account;
--  * for an employee: same organization, not one who already has access, and his own number.
create or replace function private.check_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_user uuid;
  v_phone text;
  v_member uuid;
begin
  new.phone := private.normalize_phone(new.phone);

  if tg_op = 'INSERT' then
    update public.member_invitations i
       set revoked_at = now()
     where i.organization_id = new.organization_id
       and i.accepted_at is null and i.revoked_at is null and i.expires_at <= now()
       and (i.phone = new.phone or (new.employee_id is not null and i.employee_id = new.employee_id));
  end if;

  if new.accepted_at is not null or new.revoked_at is not null then
    return new; -- accepting / revoking an invitation is never blocked here
  end if;

  if new.employee_id is not null then
    select e.organization_id, e.user_id, e.phone into v_org, v_user, v_phone from public.employees e where e.id = new.employee_id;
    if v_org is distinct from new.organization_id then
      raise exception 'the employee belongs to another organization' using errcode = '42501';
    end if;
    if v_user is not null then
      raise exception 'employee already has access' using errcode = '22023';
    end if;
    -- the number must be the employee's own (an employee with no phone on file can't be invited)
    if v_phone is null or v_phone is distinct from new.phone then
      raise exception 'the invitation number is not the employee''s phone' using errcode = '22023';
    end if;
  end if;

  select m.user_id into v_member
    from public.memberships m
    join auth.users u on u.id = m.user_id
   where m.organization_id = new.organization_id and private.normalize_phone(u.phone) = new.phone
   limit 1;
  if v_member is not null then
    if exists (select 1 from public.employees e where e.organization_id = new.organization_id and e.user_id = v_member
                 and e.id is distinct from new.employee_id) then
      raise exception 'this number is a member linked to another employee' using errcode = '22023';
    end if;
    raise exception 'this number is already a member' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists member_invitations_employee on public.member_invitations;
drop trigger if exists member_invitations_link on public.member_invitations;
create trigger member_invitations_link before insert or update of phone, employee_id on public.member_invitations
  for each row execute function private.check_invitation();

-- A new number for an employee cancels his pending invitation (it went to the old number).
create or replace function private.employee_phone_revokes_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.phone is distinct from old.phone then
    update public.member_invitations
       set revoked_at = now()
     where employee_id = new.id and accepted_at is null and revoked_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists employees_phone_invitation on public.employees;
create trigger employees_phone_invitation after update of phone on public.employees
  for each row execute function private.employee_phone_revokes_invitation();

-- employees.user_id is written by the database only (accept_pending_invitations runs as the owner).
create or replace function private.guard_employee_user()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and ((tg_op = 'INSERT' and new.user_id is not null) or (tg_op = 'UPDATE' and new.user_id is distinct from old.user_id)) then
    raise exception 'employees.user_id is set by the database (accepted invitation)' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists employees_guard_user on public.employees;
create trigger employees_guard_user before insert or update on public.employees
  for each row execute function private.guard_employee_user();

-- Accepting invitations also links the invited employee (skipped if this account already has an
-- employee in that organization or the employee got another account meanwhile — sign-in never fails).
create or replace function public.accept_pending_invitations()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_phone text;
  v_count int := 0;
  r record;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select private.normalize_phone(u.phone) into v_phone from auth.users u where u.id = v_user;
  if v_phone is null then
    return 0;
  end if;

  for r in
    select * from public.member_invitations i
    where i.phone = v_phone and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    for update
  loop
    insert into public.memberships (organization_id, user_id, role, created_by)
    values (r.organization_id, v_user, r.role, r.created_by)
    on conflict (organization_id, user_id) do nothing;

    update public.member_invitations
      set accepted_at = now(), accepted_by = v_user
      where id = r.id;

    if r.employee_id is not null then
      update public.employees e
        set user_id = v_user
        where e.id = r.employee_id
          and e.organization_id = r.organization_id
          and e.user_id is null
          and e.phone = v_phone -- only the employee's own number, whatever happened to the invitation row
          and not exists (select 1 from public.employees x where x.organization_id = r.organization_id and x.user_id = v_user);
    end if;

    update public.profiles
      set default_organization_id = coalesce(default_organization_id, r.organization_id),
          full_name = coalesce(full_name, r.full_name)
      where id = v_user;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
revoke all on function public.accept_pending_invitations() from public, anon;
grant execute on function public.accept_pending_invitations() to authenticated;

-- Employees as the members page needs them (members.manage): who is linked to which account,
-- and the phone to pre-fill / match an invitation. No salaries, ids or documents.
create or replace function public.member_employee_links(p_org uuid)
returns table (employee_id uuid, full_name text, job_title text, phone text, user_id uuid, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_org, 'members.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select e.id, e.full_name, e.job_title, e.phone, e.user_id, e.status
    from public.employees e
    where e.organization_id = p_org and (e.status <> 'final_exit' or e.user_id is not null)
    order by e.full_name;
end;
$$;
revoke all on function public.member_employee_links(uuid) from public, anon;
grant execute on function public.member_employee_links(uuid) to authenticated, service_role;

-- Link an EXISTING member to the employee whose number is his account's (members.manage).
create or replace function public.link_member_employee(p_employee uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_linked uuid;
  v_phone text;
begin
  select e.organization_id, e.user_id, e.phone into v_org, v_linked, v_phone from public.employees e where e.id = p_employee for update;
  if v_org is null or not private.has_permission(v_org, 'members.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.memberships m where m.organization_id = v_org and m.user_id = p_user) then
    raise exception 'not a member of this organization' using errcode = '22023';
  end if;
  if v_linked is not null then
    raise exception 'employee already has access' using errcode = '22023';
  end if;
  if exists (select 1 from public.employees e where e.organization_id = v_org and e.user_id = p_user) then
    raise exception 'this number is a member linked to another employee' using errcode = '22023';
  end if;
  if v_phone is null or v_phone is distinct from (select private.normalize_phone(u.phone) from auth.users u where u.id = p_user) then
    raise exception 'the member''s phone is not the employee''s phone' using errcode = '22023';
  end if;
  update public.employees set user_id = p_user where id = p_employee;
end;
$$;
revoke all on function public.link_member_employee(uuid, uuid) from public, anon;
grant execute on function public.link_member_employee(uuid, uuid) to authenticated, service_role;

-- Unlink an employee from his account (members.manage); he can be invited again afterwards.
-- The membership itself is untouched (suspend it on the members page). Audited via employees' audit trigger.
create or replace function public.unlink_employee_account(p_employee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select e.organization_id into v_org from public.employees e where e.id = p_employee for update;
  if v_org is null or not private.has_permission(v_org, 'members.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.employees set user_id = null where id = p_employee and user_id is not null;
end;
$$;
revoke all on function public.unlink_employee_account(uuid) from public, anon;
grant execute on function public.unlink_employee_account(uuid) to authenticated, service_role;


-- Users never create an invitation already revoked / accepted, never un-revoke one and never write the
-- acceptance stamps (accept_pending_invitations, a definer, does) — otherwise a revoked insert skips the
-- checks above and is then switched on. SECURITY INVOKER: it looks at the caller.
create or replace function private.guard_invitation_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.revoked_at is not null or new.accepted_at is not null or new.accepted_by is not null then
      raise exception 'an invitation starts pending' using errcode = '42501';
    end if;
  else
    if new.accepted_at is distinct from old.accepted_at or new.accepted_by is distinct from old.accepted_by then
      raise exception 'acceptance is set by the database' using errcode = '42501';
    end if;
    if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
      raise exception 'a revoked invitation stays revoked' using errcode = '42501';
    end if;
    if old.accepted_at is not null and new.revoked_at is distinct from old.revoked_at then
      raise exception 'an accepted invitation can''t be revoked' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists member_invitations_state on public.member_invitations;
create trigger member_invitations_state before insert or update on public.member_invitations
  for each row execute function private.guard_invitation_state();
