-- The employee's phone is required (owner, Nov 2026: «لازم رقم جواله») — it is the number he signs
-- in with once he gets access, and the invitation must be his own number.
-- Non-destructive: no column change. Signed-in users can't add an employee without a phone or empty
-- one. The app's form always asks for it (owner's rule; every employee had one when this shipped);
-- here an older row without one isn't refused on other updates, so database functions that touch
-- other columns of such a row keep working.

-- invoker: it checks who is writing (a definer would always run as the owner)
create or replace function private.employee_phone_required()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and new.phone is null
     and (tg_op = 'INSERT' or old.phone is not null) then
    raise exception 'employee phone required' using errcode = '23502';
  end if;
  return new;
end;
$$;

drop trigger if exists employees_phone_required on public.employees;
create trigger employees_phone_required before insert or update of phone on public.employees
  for each row execute function private.employee_phone_required();
