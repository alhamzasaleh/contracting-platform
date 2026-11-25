-- =============================================================================
-- Marketers on commission (owner, Nov 2026).
--
-- Owner decisions:
--   1. the owner picks the marketer on the client's record («جاء عن طريق»);
--   2. each marketer has a percentage the owner changes any time — a contract keeps the
--      percentage of its agreed quote version (snapshot, fixed when the client accepts);
--   3. commission = percentage × the original contract's value before VAT (after any discount),
--      never the additional works;
--   4. due once the client has paid every payment of the original contract in full;
--   5. per quote the marketer can be changed or removed (default: the client's), copied to the contract;
--   7. the price carries the commission: price = cost × (1 + contingency) ÷ (1 − margin − commission)
--      (src/lib/engine/price.ts) — never shown to the client;
--   8. paid commission is a project cost (project_actuals) with a numbered payment voucher (PV-);
--   9. each marketer follows his clients and commissions on his own page (/m/<MK-…>/<token>).
--
-- Tables: marketers (MK-), marketer_commissions (one per contract, written only by the database),
-- commission_payments (PV-, only via public.record_commission_payment), marketer_portal_links.
-- Columns: clients.marketer_id, quotes.marketer_id (set only by save_quote_version),
-- quote_version_costs.marketer_id / commission_percent / commission_amount (costs.view),
-- contracts.marketer_id (from the agreed version, by the database).
-- =============================================================================

-- 1. Permission -------------------------------------------------------------------------------
create or replace function private.all_permissions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'settings.manage', 'members.manage', 'audit.view',
    'clients.view', 'clients.manage',
    'catalogue.view', 'catalogue.manage', 'costs.view',
    'quotes.view', 'quotes.manage',
    'projects.view', 'projects.manage',
    'schedule.view', 'schedule.manage',
    'purchases.view', 'purchases.manage',
    'finance.view', 'finance.manage',
    'approvals.decide', 'reports.view',
    'hr.view', 'hr.manage',
    'marketers.manage'
  ]::text[]
$$;

-- 2. Document numbers: MK- (marketer), PV- (payment voucher) ----------------------------------
create or replace function private.document_prefix(p_doc_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_doc_type
    when 'client' then 'CL'
    when 'request' then 'R'
    when 'survey' then 'SV'
    when 'quote' then 'Q'
    when 'contract' then 'C'
    when 'project' then 'P'
    when 'purchase' then 'PO'
    when 'invoice' then 'INV'
    when 'addendum' then 'AD'
    when 'maintenance' then 'MR'
    when 'receipt' then 'RV'
    when 'marketer' then 'MK'
    when 'payment_voucher' then 'PV'
  end
$$;

-- 3. Marketers --------------------------------------------------------------------------------
create table public.marketers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null,
  name text not null check (char_length(name) between 2 and 160),
  phone text check (phone ~ '^\d{8,15}$'),
  -- of the contract value before VAT; capped so margin + commission always leaves a price
  commission_percent numeric(5, 2) not null default 0 check (commission_percent >= 0 and commission_percent <= 50),
  iban text check (iban ~ '^SA\d{22}$'),
  notes text check (char_length(notes) <= 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, number)
);
create trigger marketers_number before insert on public.marketers for each row execute function private.assign_document_number('marketer');
create trigger marketers_lock_number before update of number on public.marketers for each row execute function private.lock_number();
create trigger marketers_created_by before insert on public.marketers for each row execute function private.set_created_by();
create trigger marketers_updated_at before update on public.marketers for each row execute function private.set_updated_at();
select private.enable_audit('public.marketers');

alter table public.marketers enable row level security;
create policy marketers_select on public.marketers for select to authenticated
  using ((select private.has_permission(organization_id, 'marketers.manage')) or (select private.has_permission(organization_id, 'finance.view')));
create policy marketers_insert on public.marketers for insert to authenticated
  with check ((select private.has_permission(organization_id, 'marketers.manage')));
create policy marketers_update on public.marketers for update to authenticated
  using ((select private.has_permission(organization_id, 'marketers.manage')))
  with check ((select private.has_permission(organization_id, 'marketers.manage')));
revoke all on public.marketers from anon, authenticated;
grant select, insert, update on public.marketers to authenticated;
grant all on public.marketers to service_role;

-- The marketer chosen on a client / quote / version / contract belongs to the same organization.
create or replace function private.check_marketer_ref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.marketer_id is not null and not exists (select 1 from public.marketers m where m.id = new.marketer_id and m.organization_id = new.organization_id) then
    raise exception 'marketer_id belongs to another organization' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.check_marketer_ref() from public;

-- «جاء عن طريق» on the client (clients.manage writes it like any other field)
alter table public.clients add column marketer_id uuid references public.marketers (id) on delete restrict;
create index clients_marketer_idx on public.clients (marketer_id) where marketer_id is not null;
create trigger clients_marketer_ref before insert or update of marketer_id on public.clients for each row execute function private.check_marketer_ref();

-- the quote's marketer: written only by save_quote_version together with the priced version
alter table public.quotes add column marketer_id uuid references public.marketers (id) on delete restrict;
create index quotes_marketer_idx on public.quotes (marketer_id) where marketer_id is not null;
create trigger quotes_marketer_ref before insert or update of marketer_id on public.quotes for each row execute function private.check_marketer_ref();

create or replace function private.guard_quote_marketer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.marketer_id := null;
    elsif new.marketer_id is distinct from old.marketer_id then
      raise exception 'the marketer is saved with a priced version' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger quotes_guard_marketer before insert or update of marketer_id on public.quotes for each row execute function private.guard_quote_marketer();

-- the version's commission (cost data: costs.view, like the rest of quote_version_costs)
alter table public.quote_version_costs
  add column marketer_id uuid references public.marketers (id) on delete restrict,
  add column commission_percent numeric(5, 2) not null default 0 check (commission_percent >= 0 and commission_percent <= 50),
  add column commission_amount numeric(14, 2) not null default 0 check (commission_amount >= 0),
  add constraint quote_version_costs_commission_marketer check (commission_percent = 0 or marketer_id is not null);
create trigger quote_version_costs_marketer_ref before insert or update of marketer_id on public.quote_version_costs for each row execute function private.check_marketer_ref();

-- the contract's marketer = its agreed version's (set by the database; fixed once accepted)
alter table public.contracts add column marketer_id uuid references public.marketers (id) on delete restrict;
create index contracts_marketer_idx on public.contracts (marketer_id) where marketer_id is not null;

create or replace function private.contract_marketer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'accepted' then
    new.marketer_id := old.marketer_id;
    return new;
  end if;
  new.marketer_id := (
    select qc.marketer_id from public.quote_versions qv
    join public.quote_version_costs qc on qc.quote_version_id = qv.id
    where qv.quote_id = new.quote_id and qv.version = new.quote_version);
  return new;
end;
$$;
revoke all on function private.contract_marketer() from public;
create trigger contracts_marketer before insert or update on public.contracts for each row execute function private.contract_marketer();

-- 4. Saving a quote version freezes the marketer and his percentage (database-checked) ---------
create or replace function public.save_quote_version(p_user uuid, p_quote uuid, p_payload jsonb)
returns table (id uuid, version int)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  q public.quotes;
  v jsonb := p_payload -> 'version';
  c jsonb := p_payload -> 'costs';
  v_id uuid;
  v_version int;
  v_marketer public.marketers;
  v_percent numeric := 0;
  v_net numeric;
begin
  select * into q from public.quotes x where x.id = p_quote;
  if q.id is null or p_user is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- act as the user for the rest of this transaction: auth.uid() → permissions (incl. delegations),
  -- created_by and the audit log all see who saved the version
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  if not private.has_permission(q.organization_id, 'quotes.manage')
     or (c is not null and jsonb_typeof(c) = 'object' and not private.has_permission(q.organization_id, 'costs.view')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v is null or jsonb_typeof(v) <> 'object' then
    raise exception 'invalid version' using errcode = '22023';
  end if;
  -- the marketer of this offer: his CURRENT percentage priced it (the server read it); a change in
  -- between is refused so the price always covers the frozen commission
  if c is not null and jsonb_typeof(c) = 'object' and coalesce(c ->> 'marketer_id', '') <> '' then
    select * into v_marketer from public.marketers m where m.id = (c ->> 'marketer_id')::uuid and m.organization_id = q.organization_id;
    if v_marketer.id is null then
      raise exception 'marketer_id belongs to another organization' using errcode = '42501';
    end if;
    if not v_marketer.is_active then
      raise exception 'marketer inactive' using errcode = '22023';
    end if;
    if coalesce((c ->> 'commission_percent')::numeric, -1) <> v_marketer.commission_percent then
      raise exception 'commission changed' using errcode = '22023';
    end if;
    v_percent := v_marketer.commission_percent;
  elsif c is not null and jsonb_typeof(c) = 'object' and coalesce((c ->> 'commission_percent')::numeric, 0) <> 0 then
    raise exception 'commission without a marketer' using errcode = '22023';
  end if;
  insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, pricing_method, estimated,
                                     discount, subtotal, vat_percent, vat, total, notes, problems, created_by)
  values (q.organization_id, q.id, 1, v -> 'selection', v -> 'quantities', v -> 'client_view', coalesce(v ->> 'pricing_method', 'unit'),
          coalesce((v ->> 'estimated')::boolean, false), coalesce((v ->> 'discount')::numeric, 0), (v ->> 'subtotal')::numeric,
          coalesce((v ->> 'vat_percent')::numeric, 0), coalesce((v ->> 'vat')::numeric, 0), (v ->> 'total')::numeric, v ->> 'notes',
          coalesce((v ->> 'problems')::int, 0), p_user)
  returning quote_versions.id, quote_versions.version into v_id, v_version;
  if c is not null and jsonb_typeof(c) = 'object' then
    -- commission on the offer's value before VAT, after any discount (never from the browser)
    v_net := coalesce((v ->> 'subtotal')::numeric, 0) - coalesce((v ->> 'discount')::numeric, 0);
    insert into public.quote_version_costs (quote_version_id, organization_id, cost, cost_with_contingency, margin_percent, lines, purchase_list,
                                            marketer_id, commission_percent, commission_amount, created_by)
    values (v_id, q.organization_id, (c ->> 'cost')::numeric, (c ->> 'cost_with_contingency')::numeric, (c ->> 'margin_percent')::numeric,
            c -> 'lines', coalesce(c -> 'purchase_list', '[]'::jsonb), v_marketer.id, v_percent, round(greatest(v_net, 0) * v_percent / 100, 2), p_user);
    update public.quotes x set marketer_id = v_marketer.id where x.id = q.id and x.marketer_id is distinct from v_marketer.id;
  end if;
  return query select v_id, v_version;
end;
$$;
revoke all on function public.save_quote_version(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_quote_version(uuid, uuid, jsonb) to service_role;

-- 5. Commissions (one per contract, written only by the database) -----------------------------
create table public.marketer_commissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contract_id uuid not null unique references public.contracts (id) on delete restrict,
  marketer_id uuid not null references public.marketers (id) on delete restrict,
  base numeric(14, 2) not null check (base >= 0),
  percent numeric(5, 2) not null check (percent > 0 and percent <= 50),
  amount numeric(14, 2) not null check (amount >= 0),
  status text not null default 'expected' check (status in ('expected', 'due', 'paid', 'cancelled')),
  due_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index marketer_commissions_marketer_idx on public.marketer_commissions (marketer_id);
create index marketer_commissions_org_idx on public.marketer_commissions (organization_id, status);
create trigger marketer_commissions_updated_at before update on public.marketer_commissions for each row execute function private.set_updated_at();
select private.enable_audit('public.marketer_commissions');

-- Payment vouchers (PV-): one per commission, never edited
create table public.commission_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null,
  commission_id uuid not null unique references public.marketer_commissions (id) on delete restrict,
  marketer_id uuid not null references public.marketers (id) on delete restrict,
  contract_id uuid not null references public.contracts (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  paid_on date not null,
  method text not null default 'transfer' check (method in ('transfer', 'cash', 'cheque')),
  reference text check (char_length(reference) <= 80),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (organization_id, number)
);
create index commission_payments_contract_idx on public.commission_payments (contract_id);
create index commission_payments_marketer_idx on public.commission_payments (marketer_id);
create trigger commission_payments_number before insert on public.commission_payments for each row execute function private.assign_document_number('payment_voucher');
create trigger commission_payments_lock_number before update of number on public.commission_payments for each row execute function private.lock_number();
create trigger commission_payments_created_by before insert on public.commission_payments for each row execute function private.set_created_by();
select private.enable_audit('public.commission_payments');

-- read: the money side (finance.view), project costs (costs.view) or whoever manages marketers;
-- written only by the database (no insert / update / delete grants)
alter table public.marketer_commissions enable row level security;
alter table public.commission_payments enable row level security;
create policy marketer_commissions_select on public.marketer_commissions for select to authenticated
  using ((select private.has_permission(organization_id, 'finance.view')) or (select private.has_permission(organization_id, 'costs.view'))
         or (select private.has_permission(organization_id, 'marketers.manage')));
create policy commission_payments_select on public.commission_payments for select to authenticated
  using ((select private.has_permission(organization_id, 'finance.view')) or (select private.has_permission(organization_id, 'costs.view'))
         or (select private.has_permission(organization_id, 'marketers.manage')));
create policy marketer_commissions_project_scope on public.marketer_commissions as restrictive for all to authenticated
  using (private.can_access_contract(organization_id, contract_id)) with check (private.can_access_contract(organization_id, contract_id));
create policy commission_payments_project_scope on public.commission_payments as restrictive for all to authenticated
  using (private.can_access_contract(organization_id, contract_id)) with check (private.can_access_contract(organization_id, contract_id));
revoke all on public.marketer_commissions, public.commission_payments from anon, authenticated;
grant select on public.marketer_commissions, public.commission_payments to authenticated;
grant all on public.marketer_commissions, public.commission_payments to service_role;

-- due = every payment of the ORIGINAL contract paid in full (addenda are not part of it)
create or replace function private.commission_sync(p_contract uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.marketer_commissions;
  v_paid boolean;
  v_number text;
  v_name text;
begin
  select * into k from public.marketer_commissions where contract_id = p_contract and status in ('expected', 'due') for update;
  if k.id is null then
    return;
  end if;
  select exists (select 1 from public.contract_payments p where p.contract_id = p_contract)
         and not exists (select 1 from public.contract_payments p where p.contract_id = p_contract and p.status <> 'paid')
  into v_paid;
  if v_paid and k.status = 'expected' then
    update public.marketer_commissions set status = 'due', due_at = now() where id = k.id;
    select c.number into v_number from public.contracts c where c.id = p_contract;
    select m.name into v_name from public.marketers m where m.id = k.marketer_id;
    perform private.notify(k.organization_id, 'finance.manage', 'commission_due',
      jsonb_build_object('number', v_number, 'marketer', v_name, 'amount', k.amount),
      '/marketers', 'commission_due:' || k.id, p_contract);
  elsif not v_paid and k.status = 'due' then
    update public.marketer_commissions set status = 'expected', due_at = null where id = k.id;
  end if;
end;
$$;
revoke all on function private.commission_sync(uuid) from public;

create or replace function private.commission_on_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  qc record;
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    -- the agreed version's marketer and percentage (frozen when the price was saved)
    select x.marketer_id, x.commission_percent, qv.subtotal - qv.discount as base into qc
    from public.quote_versions qv join public.quote_version_costs x on x.quote_version_id = qv.id
    where qv.quote_id = new.quote_id and qv.version = new.quote_version;
    if qc.marketer_id is not null and qc.commission_percent > 0 then
      insert into public.marketer_commissions (organization_id, contract_id, marketer_id, base, percent, amount, created_by)
      values (new.organization_id, new.id, qc.marketer_id, greatest(qc.base, 0), qc.commission_percent, round(greatest(qc.base, 0) * qc.commission_percent / 100, 2), auth.uid())
      on conflict (contract_id) do nothing;
      perform private.commission_sync(new.id);
    end if;
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.marketer_commissions set status = 'cancelled', cancelled_at = now() where contract_id = new.id and status in ('expected', 'due');
  end if;
  return null;
end;
$$;
revoke all on function private.commission_on_contract() from public;
create trigger contracts_commission after update of status on public.contracts for each row execute function private.commission_on_contract();

create or replace function private.commission_on_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.commission_sync(case when tg_op = 'DELETE' then old.contract_id else new.contract_id end);
  return null;
end;
$$;
revoke all on function private.commission_on_payment() from public;
create trigger contract_payments_commission after insert or update of status or delete on public.contract_payments
  for each row execute function private.commission_on_payment();

-- Paying a due commission (finance.manage, once, the full amount) → payment voucher PV-
create or replace function public.record_commission_payment(p_commission uuid, p_paid_on date, p_method text, p_reference text default null, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.marketer_commissions;
  v_number text;
begin
  select * into k from public.marketer_commissions where id = p_commission for update;
  if k.id is null or not private.has_permission(k.organization_id, 'finance.manage') or not private.can_access_contract(k.organization_id, k.contract_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if k.status = 'paid' then
    raise exception 'commission already paid' using errcode = '22023';
  end if;
  if k.status <> 'due' then
    raise exception 'commission not due' using errcode = '22023';
  end if;
  if k.amount <= 0 then
    raise exception 'nothing to pay' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Asia/Riyadh')::date or p_paid_on < (now() at time zone 'Asia/Riyadh')::date - 366 then
    raise exception 'invalid date' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('transfer', 'cash', 'cheque') then
    raise exception 'invalid method' using errcode = '22023';
  end if;
  if char_length(coalesce(p_reference, '')) > 80 or char_length(coalesce(p_note, '')) > 500 then
    raise exception 'invalid' using errcode = '22023';
  end if;
  insert into public.commission_payments (organization_id, commission_id, marketer_id, contract_id, amount, paid_on, method, reference, note)
  values (k.organization_id, k.id, k.marketer_id, k.contract_id, k.amount, p_paid_on, p_method, nullif(trim(p_reference), ''), nullif(trim(p_note), ''))
  returning number into v_number;
  update public.marketer_commissions set status = 'paid', paid_at = now() where id = k.id;
  return v_number;
end;
$$;
revoke all on function public.record_commission_payment(uuid, date, text, text, text) from public, anon;
grant execute on function public.record_commission_payment(uuid, date, text, text, text) to authenticated;

-- Marketer names for the client form / client page / pricing screen (no phone, IBAN or notes;
-- the percentage only for costs.view or marketers.manage)
create or replace function public.marketer_choices(p_org uuid)
returns table (id uuid, number text, name text, is_active boolean, commission_percent numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.number, m.name, m.is_active,
         case when private.has_permission(p_org, 'costs.view') or private.has_permission(p_org, 'marketers.manage') then m.commission_percent end
  from public.marketers m
  where m.organization_id = p_org
    and (private.has_permission(p_org, 'clients.view') or private.has_permission(p_org, 'quotes.view')
         or private.has_permission(p_org, 'marketers.manage') or private.has_permission(p_org, 'finance.view'))
  order by m.is_active desc, m.name
$$;
revoke all on function public.marketer_choices(uuid) from public, anon;
grant execute on function public.marketer_choices(uuid) to authenticated;

-- 6. Notification: a commission became due → finance.manage ----------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted', 'payment_received', 'payment_late', 'doc_expiry', 'approval_reminder', 'maintenance_request',
  'project_delay', 'project_over_budget', 'project_losing', 'missed_visit', 'agreement_review',
  'quote_accepted', 'quote_changes_requested', 'quote_rejected', 'commission_due'));
alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check check (kind in (
  'approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted', 'payment_received', 'payment_late', 'doc_expiry', 'approval_reminder', 'maintenance_request',
  'project_delay', 'project_over_budget', 'project_losing', 'missed_visit', 'agreement_review',
  'quote_accepted', 'quote_changes_requested', 'quote_rejected', 'commission_due'));

-- 7. Qoyod: a commission payment = expense bill (vendor = the marketer) + its payment ---------
-- (same pattern as subcontractor payments: mk: / mkp:, the payment waits for "Approved")
alter table public.qoyod_settings add column commission_account_id int check (commission_account_id > 0);
grant insert (commission_account_id) on public.qoyod_settings to authenticated;
grant update (commission_account_id) on public.qoyod_settings to authenticated;

alter table public.qoyod_sync_jobs drop constraint qoyod_sync_jobs_entity_type_check;
alter table public.qoyod_sync_jobs add constraint qoyod_sync_jobs_entity_type_check
  check (entity_type in ('client', 'supplier', 'subcontractor', 'contract_payment', 'addendum', 'purchase', 'payroll_run', 'subcontractor_payment', 'petty_cash', 'petty_cash_opening',
                         'marketer', 'commission_payment'));

create or replace function private.qoyod_on_commission_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.qoyod_enqueue(new.organization_id, 'bill', 'commission_payment', new.id, 'mk:' || new.id);
  perform private.qoyod_enqueue(new.organization_id, 'bill_payment', 'commission_payment', new.id, 'mkp:' || new.id, new.amount);
  return null;
end;
$$;
revoke all on function private.qoyod_on_commission_payment() from public;
create trigger commission_payments_qoyod after insert on public.commission_payments
  for each row execute function private.qoyod_on_commission_payment();

-- 8. Actual project cost: + commission paid (owner: a cost once paid) -------------------------
drop function private.project_actuals(uuid);
create or replace function private.project_actuals(p_contract uuid)
returns table (materials numeric, subcontractors numeric, labour numeric, maintenance numeric, commission numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(m.quantity * m.unit_cost) from public.inventory_movements m where m.contract_id = p_contract), 0)
    + coalesce((select sum(l.amount * case when o.vat_number is not null or p.subtotal = 0 then 1 else p.total / p.subtotal end)
                from public.purchases p
                join public.purchase_lines l on l.purchase_id = p.id and l.kind = 'expense'
                join public.organizations o on o.id = p.organization_id
                where p.contract_id = p_contract and p.status = 'recorded'), 0)
    + coalesce((select sum(e.amount) from public.petty_cash_entries e where e.contract_id = p_contract and e.kind = 'expense'), 0),
    coalesce((select sum(w.amount) from public.subcontractor_work w
              join public.subcontractor_agreements g on g.id = w.agreement_id where g.contract_id = p_contract), 0),
    private.project_labour(p_contract),
    coalesce((select sum(r.cost) from public.maintenance_requests r where r.contract_id = p_contract and r.covered), 0),
    coalesce((select sum(k.amount) from public.commission_payments k where k.contract_id = p_contract), 0)
$$;
revoke all on function private.project_actuals(uuid) from public;

-- Daily reminders: expected cost includes the commission, actual cost the commission paid.
create or replace function public.run_daily_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  t record;
  v_count int := 0;
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_act record;
  v_est_mat numeric;
  v_est_all numeric;
  v_add_mat numeric;
  v_add_all numeric;
  v_revenue numeric;
  v_ratio numeric;
  v_bucket int;
  v_expected numeric;
  v_actual numeric;
  v_cost numeric;
  v_last date;
  v_gap int;
begin
  for r in
    select p.id, p.organization_id, p.contract_id, p.label, p.amount - coalesce(p.paid_amount, 0) as left_amount, c.number,
           (v_today - (p.requested_at at time zone 'Asia/Riyadh')::date) as age
    from public.contract_payments p join public.contracts c on c.id = p.contract_id
    where p.status = 'requested' and p.requested_at is not null
      and (v_today - (p.requested_at at time zone 'Asia/Riyadh')::date) in (7, 14, 30, 60, 90)
  loop
    perform private.notify(r.organization_id, 'finance.view', 'payment_late',
      jsonb_build_object('number', r.number, 'label', r.label, 'amount', r.left_amount, 'days', r.age),
      '/reports', 'late:' || r.id || ':' || r.age, r.contract_id);
    v_count := v_count + 1;
  end loop;

  -- addenda: their payment is requested when the client accepts
  for r in
    select a.id, a.organization_id, a.contract_id, a.number || ' — ' || a.title as label, a.total - coalesce(a.paid_amount, 0) as left_amount, c.number,
           (v_today - (a.accepted_at at time zone 'Asia/Riyadh')::date) as age
    from public.addenda a join public.contracts c on c.id = a.contract_id
    where a.status = 'accepted' and a.payment_status = 'requested' and a.accepted_at is not null
      and (v_today - (a.accepted_at at time zone 'Asia/Riyadh')::date) in (7, 14, 30, 60, 90)
  loop
    perform private.notify(r.organization_id, 'finance.view', 'payment_late',
      jsonb_build_object('number', r.number, 'label', r.label, 'amount', r.left_amount, 'days', r.age),
      '/reports', 'late:' || r.id || ':' || r.age, r.contract_id);
    v_count := v_count + 1;
  end loop;

  for r in
    select e.organization_id, e.id, e.full_name, d.kind, d.expiry, (d.expiry - v_today) as days
    from public.employees e
    cross join lateral (values ('id', e.id_expiry), ('passport', e.passport_expiry), ('insurance', e.insurance_expiry)) as d(kind, expiry)
    where e.status <> 'final_exit' and d.expiry is not null and (d.expiry - v_today) in (60, 30, 7, 0)
  loop
    perform private.notify(r.organization_id, 'hr.view', 'doc_expiry',
      jsonb_build_object('name', r.full_name, 'doc', r.kind, 'days', r.days, 'date', r.expiry), '/team/payroll', 'doc:' || r.id || ':' || r.kind || ':' || r.days);
    v_count := v_count + 1;
  end loop;

  for r in
    select a.id, a.organization_id, a.kind, a.entity, a.entity_id, a.details ->> 'number' as number
    from public.approvals a
    where a.status = 'pending' and a.created_at < now() - interval '1 day'
  loop
    select * into t from private.approval_target(r.entity, r.entity_id);
    perform private.notify(r.organization_id, 'approvals.decide', 'approval_reminder',
      jsonb_build_object('approval_id', r.id, 'kind', r.kind, 'number', r.number), t.link, 'remind:' || r.id || ':' || v_today, t.contract_id);
    v_count := v_count + 1;
  end loop;

  -- Projects under way (accepted, not handed over) + handed over, still in warranty (profit only).
  for r in
    select x.* from (
      select c.id, c.organization_id, c.number, c.total, c.start_date, c.duration_days, c.quote_id, c.quote_version, c.accepted_at,
             cl.name as client,
             c.start_date + c.duration_days + coalesce((select sum(a.extra_days) from public.addenda a where a.contract_id = c.id and a.status = 'accepted'), 0)::int as due,
             exists (select 1 from public.project_stages s where s.contract_id = c.id and s.is_final and s.status = 'confirmed') as handed
      from public.contracts c
      join public.clients cl on cl.id = c.client_id
      where c.status = 'accepted'
    ) x
    where not x.handed or private.warranty_end(x.id) >= v_today
  loop
    -- delay
    if not r.handed and v_today - r.due in (1, 7, 14, 30, 60) then
      perform private.notify(r.organization_id, 'projects.view', 'project_delay',
        jsonb_build_object('number', r.number, 'client', r.client, 'days', v_today - r.due, 'due', r.due),
        '/projects/' || r.number, 'delay:' || r.id || ':' || (v_today - r.due), r.id);
      v_count := v_count + 1;
    end if;

    -- missed visits (work started)
    if not r.handed and r.start_date <= v_today then
      select max((v.checked_in_at at time zone 'Asia/Riyadh')::date) into v_last from public.site_visits v where v.contract_id = r.id;
      v_last := greatest(coalesce(v_last, r.start_date), r.start_date);
      v_gap := v_today - v_last;
      if v_gap in (3, 7, 14) then
        perform private.notify(r.organization_id, 'projects.manage', 'missed_visit',
          jsonb_build_object('number', r.number, 'client', r.client, 'days', v_gap),
          '/projects/' || r.number, 'visit:' || r.id || ':' || v_last || ':' || v_gap, r.id);
        v_count := v_count + 1;
      end if;
    end if;

    -- costs (costs.view only): the quote's estimate + accepted addenda estimates
    select coalesce(sum((l ->> 'cost')::numeric) filter (where l ->> 'group' = 'material'), 0), coalesce(sum((l ->> 'cost')::numeric), 0)
    into v_est_mat, v_est_all
    from public.quote_versions qv
    join public.quote_version_costs qc on qc.quote_version_id = qv.id
    cross join lateral jsonb_array_elements(qc.lines) l
    where qv.quote_id = r.quote_id and qv.version = r.quote_version;
    select coalesce(sum(k.material_cost), 0), coalesce(sum(k.material_cost + k.other_cost), 0) into v_add_mat, v_add_all
    from public.addendum_costs k join public.addenda a on a.id = k.addendum_id
    where a.contract_id = r.id and a.status = 'accepted';
    v_est_mat := v_est_mat + v_add_mat;
    v_est_all := v_est_all + v_add_all;
    -- the marketer's commission is part of the expected cost (the price carries it); paid → actual
    v_est_all := v_est_all + coalesce((select k.amount from public.marketer_commissions k where k.contract_id = r.id and k.status <> 'cancelled'), 0);
    select * into v_act from private.project_actuals(r.id);

    if not r.handed and v_est_mat > 0 and v_act.materials > v_est_mat then
      v_ratio := v_act.materials / v_est_mat;
      v_bucket := case when v_ratio >= 1.5 then 150 when v_ratio >= 1.25 then 125 when v_ratio >= 1.1 then 110 else 100 end;
      perform private.notify(r.organization_id, 'costs.view', 'project_over_budget',
        jsonb_build_object('number', r.number, 'client', r.client, 'percent', round((v_ratio - 1) * 100), 'actual', round(v_act.materials, 2), 'estimated', round(v_est_mat, 2)),
        '/purchases/costs', 'budget:' || r.id || ':' || v_bucket, r.id);
      v_count := v_count + 1;
    end if;

    select r.total - coalesce((qv.client_view ->> 'vat')::numeric, 0) into v_revenue
    from public.quote_versions qv where qv.quote_id = r.quote_id and qv.version = r.quote_version;
    v_revenue := coalesce(v_revenue, r.total)
      + coalesce((select sum(a.amount) from public.addenda a where a.contract_id = r.id and a.status = 'accepted'), 0);
    v_cost := v_act.materials + v_act.subcontractors + v_act.labour + v_act.maintenance + v_act.commission;
    v_actual := v_revenue - v_cost;
    v_expected := case when v_est_all > 0 then v_revenue - v_est_all end;
    -- the profit includes in-house labour (built from salaries): costs.view and hr.view
    if v_cost > 0 and (v_actual < 0 or (v_expected is not null and v_expected > 0 and v_actual < v_expected * 0.5)) then
      perform private.notify(r.organization_id, 'costs.view', 'project_losing',
        jsonb_build_object('number', r.number, 'client', r.client, 'profit', round(v_actual, 2), 'expected', round(v_expected, 2)),
        '/purchases/costs', 'losing:' || r.id || ':' || case when v_actual < 0 then 'loss' else 'low' end, r.id, 'hr.view');
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.run_daily_reminders() from public, anon, authenticated;
grant execute on function public.run_daily_reminders() to service_role;

-- Backfill: also commission payments.
create or replace function public.qoyod_backfill(p_org uuid, p_from date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before int;
  v_after int;
begin
  if not private.has_permission(p_org, 'settings.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_from > current_date then
    raise exception 'invalid date' using errcode = '22023';
  end if;
  select count(*) into v_before from public.qoyod_sync_jobs where organization_id = p_org;
  update public.qoyod_settings set sync_from = p_from where organization_id = p_org;

  perform private.qoyod_enqueue(p.organization_id, 'invoice', 'contract_payment', p.id, 'cp:' || p.id)
  from public.contract_payments p
  where p.organization_id = p_org and p.status in ('requested', 'paid') and coalesce(p.requested_at, p.paid_at, p.created_at) >= p_from;
  perform private.qoyod_enqueue(p.organization_id, 'invoice_payment', 'contract_payment', p.id, 'cp:' || p.id || ':' || p.paid_amount, p.paid_amount)
  from public.contract_payments p
  where p.organization_id = p_org and coalesce(p.paid_amount, 0) > 0 and coalesce(p.paid_at, p.created_at) >= p_from;

  perform private.qoyod_enqueue(a.organization_id, 'invoice', 'addendum', a.id, 'ad:' || a.id)
  from public.addenda a
  where a.organization_id = p_org and a.status = 'accepted' and coalesce(a.accepted_at, a.created_at) >= p_from;
  perform private.qoyod_enqueue(a.organization_id, 'invoice_payment', 'addendum', a.id, 'ad:' || a.id || ':' || a.paid_amount, a.paid_amount)
  from public.addenda a
  where a.organization_id = p_org and coalesce(a.paid_amount, 0) > 0 and coalesce(a.paid_at::timestamptz, a.created_at) >= p_from;

  perform private.qoyod_enqueue(p.organization_id, 'bill', 'purchase', p.id, 'po:' || p.id)
  from public.purchases p
  where p.organization_id = p_org and p.status = 'recorded' and p.total > 0 and coalesce(p.invoice_date::timestamptz, p.recorded_at, p.created_at) >= p_from;
  perform private.qoyod_enqueue(p.organization_id, 'bill_payment', 'purchase', p.id, 'pp:' || p.id, p.total)
  from public.purchases p
  where p.organization_id = p_org and p.status = 'recorded' and p.total > 0 and p.paid_on is not null and p.paid_on >= p_from;

  perform private.qoyod_enqueue(s.organization_id, 'bill', 'subcontractor_payment', s.id, 'sb:' || s.id)
  from public.subcontractor_payments s where s.organization_id = p_org and s.paid_on >= p_from;
  perform private.qoyod_enqueue(s.organization_id, 'bill_payment', 'subcontractor_payment', s.id, 'sp:' || s.id, s.amount)
  from public.subcontractor_payments s where s.organization_id = p_org and s.paid_on >= p_from;

  perform private.qoyod_enqueue(k.organization_id, 'bill', 'commission_payment', k.id, 'mk:' || k.id)
  from public.commission_payments k where k.organization_id = p_org and k.paid_on >= p_from;
  perform private.qoyod_enqueue(k.organization_id, 'bill_payment', 'commission_payment', k.id, 'mkp:' || k.id, k.amount)
  from public.commission_payments k where k.organization_id = p_org and k.paid_on >= p_from;

  perform private.qoyod_enqueue_petty(p_org, p_from);

  select count(*) into v_after from public.qoyod_sync_jobs where organization_id = p_org;
  return v_after - v_before;
end;
$$;
revoke all on function public.qoyod_backfill(uuid, date) from public, anon;
grant execute on function public.qoyod_backfill(uuid, date) to authenticated, service_role;

-- 9. The marketer's own page (/m/<MK-…>/<token>) --------------------------------------------
-- Same rules as the client page: 16+ random characters shown once, only the SHA-256 stored,
-- revocable, renewable (a new link revokes the older ones), read only by the server (service role)
-- after per-IP rate limiting. Expires after a year unless renewed.
create table public.marketer_portal_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  marketer_id uuid not null references public.marketers (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index marketer_portal_links_marketer_idx on public.marketer_portal_links (marketer_id, created_at desc);
create trigger marketer_portal_links_created_by before insert on public.marketer_portal_links for each row execute function private.set_created_by();
select private.enable_audit('public.marketer_portal_links');
alter table public.marketer_portal_links enable row level security;
create policy marketer_portal_links_select on public.marketer_portal_links for select to authenticated
  using ((select private.has_permission(organization_id, 'marketers.manage')));
revoke all on public.marketer_portal_links from anon, authenticated;
grant select on public.marketer_portal_links to authenticated;
grant all on public.marketer_portal_links to service_role;

create or replace function public.issue_marketer_link(p_marketer uuid, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.marketers;
  v_id uuid;
begin
  select * into m from public.marketers where id = p_marketer for update;
  if m.id is null or not private.has_permission(m.organization_id, 'marketers.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid link' using errcode = '22023';
  end if;
  if not m.is_active then
    raise exception 'marketer inactive' using errcode = '22023';
  end if;
  insert into public.marketer_portal_links (organization_id, marketer_id, token_hash, expires_at)
  values (m.organization_id, m.id, p_token_hash, now() + interval '365 days')
  returning id into v_id;
  update public.marketer_portal_links set revoked_at = now() where marketer_id = m.id and revoked_at is null and id <> v_id;
  return v_id;
end;
$$;
revoke all on function public.issue_marketer_link(uuid, text) from public, anon;
grant execute on function public.issue_marketer_link(uuid, text) to authenticated;

create or replace function public.revoke_marketer_links(p_marketer uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.marketers;
  v_count int;
begin
  select * into m from public.marketers where id = p_marketer;
  if m.id is null or not private.has_permission(m.organization_id, 'marketers.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.marketer_portal_links set revoked_at = now() where marketer_id = m.id and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.revoke_marketer_links(uuid) from public, anon;
grant execute on function public.revoke_marketer_links(uuid) to authenticated;

-- a deactivated marketer's page closes at once
create or replace function private.marketer_deactivated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.is_active and old.is_active then
    update public.marketer_portal_links set revoked_at = now() where marketer_id = new.id and revoked_at is null;
  end if;
  return null;
end;
$$;
revoke all on function private.marketer_deactivated() from public;
create trigger marketers_deactivated after update of is_active on public.marketers for each row execute function private.marketer_deactivated();

-- What the marketer sees: his name and percentage, and per contract that earned him a commission:
-- the client's NAME only (no phone / id), contract number, date, status, value before VAT, the
-- frozen percentage, the commission (expected / due / paid / cancelled) and his payment vouchers.
-- No costs, margins, quotes that never became contracts, or other marketers.
create or replace function public.marketer_portal_view(p_number text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.marketer_portal_links;
  m public.marketers;
  o public.organizations;
begin
  if not private.portal_token_ok(p_token) or p_number is null or char_length(p_number) > 30 then
    return null;
  end if;
  select x.* into l
  from public.marketer_portal_links x join public.marketers mk on mk.id = x.marketer_id
  where x.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and x.revoked_at is null and x.expires_at > now() and mk.number = p_number and mk.is_active
  limit 1;
  if l.id is null then
    return null;
  end if;
  select * into m from public.marketers where id = l.marketer_id;
  select * into o from public.organizations where id = l.organization_id;
  return jsonb_build_object(
    'org', jsonb_build_object('id', o.id, 'name', o.name, 'legal_name', o.legal_name, 'phone', o.phone, 'logo_path', o.logo_path, 'brand', o.brand),
    'marketer', jsonb_build_object('number', m.number, 'name', m.name, 'commission_percent', m.commission_percent),
    'expires_at', l.expires_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client', cl.name, 'contract', c.number, 'date', coalesce(c.accepted_at, c.created_at), 'contract_status', c.status,
        'handed_over', exists (select 1 from public.project_stages s where s.contract_id = c.id and s.is_final and s.status = 'confirmed'),
        'base', k.base, 'percent', k.percent, 'amount', k.amount, 'status', k.status, 'due_at', k.due_at, 'paid_at', k.paid_at,
        'vouchers', coalesce((select jsonb_agg(jsonb_build_object('number', v.number, 'paid_on', v.paid_on, 'amount', v.amount, 'method', v.method) order by v.paid_on)
                              from public.commission_payments v where v.commission_id = k.id), '[]'::jsonb))
        order by coalesce(c.accepted_at, c.created_at) desc)
      from public.marketer_commissions k
      join public.contracts c on c.id = k.contract_id
      join public.clients cl on cl.id = c.client_id
      where k.marketer_id = m.id), '[]'::jsonb));
end;
$$;
revoke all on function public.marketer_portal_view(text, text) from public, anon, authenticated;
grant execute on function public.marketer_portal_view(text, text) to service_role;
