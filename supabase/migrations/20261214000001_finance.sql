-- =============================================================================
-- Phase 9a — Collections & owner finance (§3.7, §3.16)
--   contract_payments: expected date (for the cash-flow forecast), when it was
--   requested, and what was actually received. Received money is recorded
--   only through public.record_client_payment() (finance.manage); the agreed
--   schedule of an accepted contract can't be rewritten.
--   finance_settings: opening cash balance and payday for the forecast.
-- =============================================================================

alter table public.contract_payments
  add column if not exists expected_date date,
  add column if not exists requested_at timestamptz,
  add column if not exists paid_amount numeric(14, 2) check (paid_amount >= 0),
  add column if not exists paid_method text check (paid_method in ('transfer', 'cash', 'cheque', 'card')),
  add column if not exists paid_reference text check (char_length(paid_reference) <= 80);

alter table public.addenda
  add column if not exists paid_at date,
  add column if not exists paid_amount numeric(14, 2) check (paid_amount >= 0);

-- payments already requested before this migration: use their last update as the request time
update public.contract_payments set requested_at = updated_at where status in ('requested', 'paid') and requested_at is null;

create or replace function private.stamp_payment_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'requested' and old.status = 'pending' and new.requested_at is null then
    new.requested_at := now();
  end if;
  return new;
end;
$$;
create trigger contract_payments_requested before update of status on public.contract_payments
  for each row execute function private.stamp_payment_request();

-- The schedule of an accepted contract is part of what the client signed.
create or replace function private.guard_contract_payment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and exists (select 1 from public.contracts c where c.id = old.contract_id and c.status = 'accepted') then
    if new.percent is distinct from old.percent or new.amount is distinct from old.amount or new.label is distinct from old.label
       or new.due_event is distinct from old.due_event or new.seq is distinct from old.seq or new.contract_id is distinct from old.contract_id then
      raise exception 'the payment schedule of an accepted contract can''t change' using errcode = '42501';
    end if;
    if new.status is distinct from old.status or new.paid_amount is distinct from old.paid_amount or new.paid_at is distinct from old.paid_at then
      raise exception 'payments are recorded through record_client_payment' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger contract_payments_guard before update on public.contract_payments
  for each row execute function private.guard_contract_payment();

-- Finance records money received (full or partial; partial stays "requested").
create or replace function public.record_client_payment(p_payment uuid, p_paid_on date, p_amount numeric, p_method text, p_reference text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.contract_payments;
  v_total numeric;
begin
  select * into p from public.contract_payments where id = p_payment for update;
  if p.id is null or not private.has_permission(p.organization_id, 'finance.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or p_paid_on is null or p_paid_on > current_date + 1
     or p_method not in ('transfer', 'cash', 'cheque', 'card') or char_length(p_reference) > 80 then
    raise exception 'invalid payment' using errcode = '22023';
  end if;
  if not exists (select 1 from public.contracts c where c.id = p.contract_id and c.status = 'accepted') then
    raise exception 'the contract isn''t accepted' using errcode = '22023';
  end if;
  v_total := coalesce(p.paid_amount, 0) + p_amount;
  update public.contract_payments
  set paid_amount = v_total, paid_at = p_paid_on, paid_method = p_method, paid_reference = nullif(trim(p_reference), ''),
      requested_at = coalesce(requested_at, now()),
      status = case when v_total >= amount - 0.005 then 'paid' else 'requested' end
  where id = p.id;
  return case when v_total >= p.amount - 0.005 then 'paid' else 'partial' end;
end;
$$;
revoke all on function public.record_client_payment(uuid, date, numeric, text, text) from public, anon;
grant execute on function public.record_client_payment(uuid, date, numeric, text, text) to authenticated, service_role;

-- Finance may set the expected date of a payment (forecast) — nothing else.
create policy contract_payments_finance_update on public.contract_payments for update to authenticated
  using ((select private.has_permission(organization_id, 'finance.manage')))
  with check ((select private.has_permission(organization_id, 'finance.manage')));
grant update (expected_date) on public.contract_payments to authenticated;

-- finance reads payments and contracts even without quotes.view
create policy contract_payments_finance_select on public.contract_payments for select to authenticated
  using ((select private.has_permission(organization_id, 'finance.view')));
create policy contracts_finance_select on public.contracts for select to authenticated
  using ((select private.has_permission(organization_id, 'finance.view')));

create table public.finance_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  cash_balance numeric(14, 2) not null default 0,
  cash_balance_on date not null default current_date,
  payday int not null default 27 check (payday between 1 and 28),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger finance_settings_updated_at before update on public.finance_settings for each row execute function private.set_updated_at();
create trigger finance_settings_created_by before insert on public.finance_settings for each row execute function private.set_created_by();
select private.enable_audit('public.finance_settings');

alter table public.finance_settings enable row level security;
create policy finance_settings_select on public.finance_settings for select to authenticated
  using ((select private.has_permission(organization_id, 'finance.view')));
create policy finance_settings_insert on public.finance_settings for insert to authenticated
  with check ((select private.has_permission(organization_id, 'finance.manage')));
create policy finance_settings_update on public.finance_settings for update to authenticated
  using ((select private.has_permission(organization_id, 'finance.manage')))
  with check ((select private.has_permission(organization_id, 'finance.manage')));
revoke all on public.finance_settings from anon;
grant select, insert, update on public.finance_settings to authenticated;
grant all on public.finance_settings to service_role;
