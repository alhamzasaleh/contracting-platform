-- =============================================================================
-- Qoyod: supplier payments and payroll (§3.15, §3.20)
--   Purchases gain a payment record (paid_on / paid_from / paid_reference), set only
--   through public.record_purchase_payment() (finance.manage) — a recorded purchase
--   is otherwise final. Paying it queues a Qoyod "simple bill payment".
--   A payroll run marked paid queues a Qoyod journal entry (salaries expense ←
--   bank) for the net salaries paid.
--   Both only post once sending is set to "Approved" (a draft bill can't be paid and
--   a journal entry has no draft) — until then they wait in the queue.
-- Non-destructive: new nullable columns, wider check constraints, new triggers.
-- =============================================================================

alter table public.purchases
  add column paid_on date,
  add column paid_from text check (paid_from in ('bank', 'cash')),
  add column paid_reference text check (char_length(paid_reference) <= 80);

alter table public.qoyod_settings
  add column salary_account_id int check (salary_account_id > 0),
  add column cash_account_id int check (cash_account_id > 0);

alter table public.qoyod_sync_jobs drop constraint qoyod_sync_jobs_kind_check;
alter table public.qoyod_sync_jobs add constraint qoyod_sync_jobs_kind_check
  check (kind in ('customer', 'vendor', 'invoice', 'invoice_payment', 'bill', 'bill_payment', 'payroll'));
alter table public.qoyod_sync_jobs drop constraint qoyod_sync_jobs_entity_type_check;
alter table public.qoyod_sync_jobs add constraint qoyod_sync_jobs_entity_type_check
  check (entity_type in ('client', 'supplier', 'contract_payment', 'addendum', 'purchase', 'payroll_run'));

-- Record that a supplier invoice was paid (once; finance only).
create or replace function public.record_purchase_payment(p_purchase uuid, p_date date, p_from text, p_reference text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.purchases;
begin
  select * into p from public.purchases where id = p_purchase for update;
  if p.id is null or not private.has_permission(p.organization_id, 'finance.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p.status <> 'recorded' then
    raise exception 'only recorded purchases can be paid' using errcode = '22023';
  end if;
  if p.paid_on is not null then
    raise exception 'already paid' using errcode = '22023';
  end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Riyadh')::date + 1 or p_from not in ('bank', 'cash')
     or char_length(coalesce(p_reference, '')) > 80 then
    raise exception 'invalid payment' using errcode = '22023';
  end if;
  update public.purchases set paid_on = p_date, paid_from = p_from, paid_reference = nullif(btrim(p_reference), '') where id = p.id;
end;
$$;
revoke all on function public.record_purchase_payment(uuid, date, text, text) from public, anon;
grant execute on function public.record_purchase_payment(uuid, date, text, text) to authenticated, service_role;

-- Staff can't write the payment fields directly (only through the function above).
create or replace function private.guard_purchase_payment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and (
     (tg_op = 'INSERT' and (new.paid_on is not null or new.paid_from is not null or new.paid_reference is not null))
     or (tg_op = 'UPDATE' and (new.paid_on is distinct from old.paid_on or new.paid_from is distinct from old.paid_from
                                or new.paid_reference is distinct from old.paid_reference))) then
    raise exception 'payments are recorded through record_purchase_payment' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger purchases_payment_guard before insert or update on public.purchases
  for each row execute function private.guard_purchase_payment();

-- Queue: purchase paid → bill payment; payroll paid → journal entry.
create or replace function private.qoyod_on_purchase_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.paid_on is not null and old.paid_on is null and new.total > 0 then
    perform private.qoyod_enqueue(new.organization_id, 'bill', 'purchase', new.id, 'po:' || new.id);
    perform private.qoyod_enqueue(new.organization_id, 'bill_payment', 'purchase', new.id, 'pp:' || new.id, new.total);
  end if;
  return null;
end;
$$;
create trigger purchases_qoyod_paid after update of paid_on on public.purchases
  for each row execute function private.qoyod_on_purchase_paid();

create or replace function private.qoyod_on_payroll_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_net numeric;
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    select coalesce(sum(l.net), 0) into v_net from public.payroll_lines l where l.run_id = new.id;
    if v_net > 0 then
      perform private.qoyod_enqueue(new.organization_id, 'payroll', 'payroll_run', new.id, 'pr:' || to_char(new.month, 'YYYY-MM'), v_net);
    end if;
  end if;
  return null;
end;
$$;
create trigger payroll_runs_qoyod after update of status on public.payroll_runs
  for each row execute function private.qoyod_on_payroll_paid();

-- The worker can put a job back without counting it as a failed try (e.g. waiting for "Approved").
create or replace function public.qoyod_defer_job(p_job uuid, p_minutes int, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.qoyod_sync_jobs
  set status = 'queued', attempts = greatest(attempts - 1, 0), next_attempt_at = now() + make_interval(mins => least(greatest(p_minutes, 5), 1440)),
      last_error = left(p_reason, 500)
  where id = p_job;
$$;
revoke all on function public.qoyod_defer_job(uuid, int, text) from public, anon, authenticated;
grant execute on function public.qoyod_defer_job(uuid, int, text) to service_role;
