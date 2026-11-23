-- =============================================================================
-- Phase 8 — Additional works (addenda), subcontractors, petty cash
-- §3.8  addenda (AD-YYYY-NNN): a priced addendum to a contract. Owner approval
--       (approvals kind 'addendum') → sent to the client page → the client
--       accepts → the delivery date moves by extra_days, its own payment is
--       requested, and a work stage is added before the final handover. No
--       progress and no purchases on it before the client accepts.
-- §3.11 subcontractors: agreement per project (lump sum | per m², weekly | by
--       progress), work done (earned) and payments; no retention.
--       petty cash: one account per holder (supervisor); top-ups/returns by
--       finance, expenses (receipt photo, AI-read) charged to projects.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Addenda
-- ---------------------------------------------------------------------------
create table public.addenda (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null,
  contract_id uuid not null references public.contracts (id) on delete restrict,
  title text not null check (char_length(title) between 2 and 160),
  description text not null check (char_length(description) between 2 and 4000),
  amount numeric(14, 2) not null check (amount >= 0),
  vat_percent numeric(5, 2) not null default 0 check (vat_percent between 0 and 100),
  vat numeric(14, 2) not null default 0 check (vat >= 0),
  total numeric(14, 2) not null check (total >= 0),
  extra_days int not null default 0 check (extra_days between 0 and 365),
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'sent', 'accepted', 'rejected', 'cancelled')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'requested', 'paid')),
  accepted_at timestamptz,
  accepted_name text check (char_length(accepted_name) <= 160),
  accepted_ip text check (char_length(accepted_ip) <= 64),
  accepted_user_agent text check (char_length(accepted_user_agent) <= 400),
  accepted_signature text check (char_length(accepted_signature) <= 200000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, number),
  check (abs(amount + vat - total) <= 0.05)
);
create index addenda_contract_idx on public.addenda (contract_id);

alter table public.project_stages add column if not exists addendum_id uuid references public.addenda (id) on delete restrict;
alter table public.purchases add column if not exists addendum_id uuid references public.addenda (id) on delete restrict;

create trigger addenda_number before insert on public.addenda for each row execute function private.assign_document_number('addendum');
create trigger addenda_lock_number before update of number on public.addenda for each row execute function private.lock_number();
create trigger addenda_updated_at before update on public.addenda for each row execute function private.set_updated_at();
create trigger addenda_created_by before insert on public.addenda for each row execute function private.set_created_by();
select private.enable_audit('public.addenda');

create or replace function private.check_addendum_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.contracts;
begin
  select * into v_contract from public.contracts where id = new.contract_id;
  if v_contract.organization_id is distinct from new.organization_id then
    raise exception 'contract_id belongs to another organization' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and v_contract.status <> 'accepted' then
    raise exception 'additional works are for an accepted contract' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.check_addendum_refs() from public;
grant execute on function private.check_addendum_refs() to authenticated, service_role;
create trigger addenda_refs before insert or update on public.addenda for each row execute function private.check_addendum_refs();

-- Staff edit only drafts; status moves through the functions below; only the client accepts.
create or replace function private.guard_addendum()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.status <> 'draft' or new.accepted_at is not null or new.payment_status <> 'pending' then
        raise exception 'new addenda start as drafts' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.accepted_at is distinct from old.accepted_at or new.accepted_name is distinct from old.accepted_name
       or new.accepted_signature is distinct from old.accepted_signature or (new.status = 'accepted' and old.status <> 'accepted') then
      raise exception 'only the client can accept' using errcode = '42501';
    end if;
    if old.status in ('accepted', 'cancelled') and (new.status <> old.status or new.amount <> old.amount or new.total <> old.total
       or new.extra_days <> old.extra_days or new.description <> old.description or new.title <> old.title) then
      raise exception 'this addendum can no longer change' using errcode = '42501';
    end if;
    -- terms change only while it's a draft (or rejected, being reworked)
    if old.status not in ('draft', 'rejected') and (new.amount <> old.amount or new.total <> old.total or new.vat <> old.vat
       or new.extra_days <> old.extra_days or new.description <> old.description or new.title <> old.title) then
      raise exception 'only drafts can be edited' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and not (
      (old.status in ('draft', 'rejected') and new.status = 'draft')
      or (new.status = 'cancelled' and old.status <> 'accepted')
      or (old.status = 'approved' and new.status = 'sent')
    ) then
      raise exception 'status changes go through submit_addendum' using errcode = '42501';
    end if;
    -- payment status: requested ↔ paid by finance (checked by RLS + here)
    if new.payment_status is distinct from old.payment_status and (old.status <> 'accepted' or new.payment_status = 'pending') then
      raise exception 'invalid payment change' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger addenda_guard before insert or update on public.addenda for each row execute function private.guard_addendum();

-- Submit a draft: the owner (approvals.decide) approves it directly; anyone else raises an approval.
create or replace function public.submit_addendum(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.addenda;
begin
  select * into a from public.addenda where id = p_id for update;
  if a.id is null or not private.has_permission(a.organization_id, 'quotes.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.status not in ('draft', 'rejected') then
    raise exception 'already submitted' using errcode = '22023';
  end if;
  if private.has_permission(a.organization_id, 'approvals.decide') then
    update public.addenda set status = 'approved' where id = p_id;
    return 'approved';
  end if;
  update public.approvals set status = 'cancelled' where entity = 'addendum' and entity_id = p_id and status = 'pending';
  insert into public.approvals (organization_id, kind, entity, entity_id, details)
  values (a.organization_id, 'addendum', 'addendum', p_id, jsonb_build_object('number', a.number, 'title', a.title, 'total', a.total, 'extra_days', a.extra_days));
  update public.addenda set status = 'pending_approval' where id = p_id;
  return 'pending_approval';
end;
$$;
revoke all on function public.submit_addendum(uuid) from public, anon;
grant execute on function public.submit_addendum(uuid) to authenticated, service_role;

create or replace function private.apply_addendum_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entity = 'addendum' and new.status is distinct from old.status then
    update public.addenda set status = case new.status when 'approved' then 'approved' else 'rejected' end
    where id = new.entity_id and status = 'pending_approval' and new.status in ('approved', 'rejected');
  end if;
  return new;
end;
$$;
create trigger approvals_addendum_decision after update on public.approvals for each row execute function private.apply_addendum_decision();

-- No progress / purchases on an addendum before the client accepts it.
create or replace function private.require_accepted_addendum()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.addendum_id is not null and not exists (
    select 1 from public.addenda a where a.id = new.addendum_id and a.status = 'accepted' and a.contract_id is not distinct from coalesce(new.contract_id, a.contract_id)
  ) then
    raise exception 'work on additional works starts after the client accepts the addendum' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger purchases_addendum before insert or update of addendum_id on public.purchases for each row execute function private.require_accepted_addendum();

create or replace function private.check_progress_addendum()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.project_stages s join public.addenda a on a.id = s.addendum_id
             where s.id = new.stage_id and a.status <> 'accepted') then
    raise exception 'work on additional works starts after the client accepts the addendum' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger progress_updates_addendum before insert on public.progress_updates for each row execute function private.check_progress_addendum();

-- The client accepts an addendum sent to their page.
create or replace function public.portal_accept_addendum(p_number text, p_token text, p_addendum uuid, p_name text, p_signature text, p_ip text, p_user_agent text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
  a public.addenda;
  v_final public.project_stages;
  v_seq int;
begin
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null then
    return false;
  end if;
  if p_name is null or char_length(trim(p_name)) < 2 or char_length(p_name) > 160 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  if p_signature is not null and (char_length(p_signature) > 200000 or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$') then
    raise exception 'invalid signature' using errcode = '22023';
  end if;
  select * into a from public.addenda where id = p_addendum and contract_id = v_link.contract_id for update;
  if a.id is null or a.status <> 'sent' then
    return false;
  end if;
  update public.addenda
  set status = 'accepted', payment_status = 'requested', accepted_at = now(), accepted_name = trim(p_name),
      accepted_ip = left(p_ip, 64), accepted_user_agent = left(p_user_agent, 400), accepted_signature = p_signature
  where id = a.id;

  -- its own work stage, before the final handover (unless already handed over)
  select * into v_final from public.project_stages where contract_id = a.contract_id and is_final order by seq desc limit 1;
  if v_final.id is not null and v_final.status <> 'confirmed' then
    v_seq := v_final.seq;
    update public.project_stages set seq = (select max(seq) + 1 from public.project_stages where contract_id = a.contract_id) where id = v_final.id;
  else
    select coalesce(max(seq), 0) + 1 into v_seq from public.project_stages where contract_id = a.contract_id;
  end if;
  insert into public.project_stages (organization_id, contract_id, seq, name, addendum_id)
  values (a.organization_id, a.contract_id, v_seq, left(a.number || ' — ' || a.title, 120), a.id);
  return true;
end;
$$;
revoke all on function public.portal_accept_addendum(text, text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.portal_accept_addendum(text, text, uuid, text, text, text, text) to service_role;

create or replace function public.portal_addenda(p_number text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
begin
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'number', a.number, 'title', a.title, 'description', a.description,
      'amount', a.amount, 'vat_percent', a.vat_percent, 'vat', a.vat, 'total', a.total, 'extra_days', a.extra_days,
      'status', a.status, 'payment_status', a.payment_status, 'accepted_at', a.accepted_at, 'accepted_name', a.accepted_name) order by a.created_at)
    from public.addenda a where a.contract_id = v_link.contract_id and a.status in ('sent', 'accepted')), '[]'::jsonb);
end;
$$;
revoke all on function public.portal_addenda(text, text) from public, anon, authenticated;
grant execute on function public.portal_addenda(text, text) to service_role;

alter table public.addenda enable row level security;
create policy addenda_select on public.addenda for select to authenticated
  using ((select private.has_permission(organization_id, 'quotes.view')) or (select private.has_permission(organization_id, 'projects.view')));
create policy addenda_insert on public.addenda for insert to authenticated
  with check ((select private.has_permission(organization_id, 'quotes.manage')));
create policy addenda_update on public.addenda for update to authenticated
  using ((select private.has_permission(organization_id, 'quotes.manage')) or (select private.has_permission(organization_id, 'finance.manage')))
  with check ((select private.has_permission(organization_id, 'quotes.manage')) or (select private.has_permission(organization_id, 'finance.manage')));
revoke all on public.addenda from anon;
grant select, insert, update on public.addenda to authenticated;
grant all on public.addenda to service_role;

-- ---------------------------------------------------------------------------
-- Subcontractors
-- ---------------------------------------------------------------------------
create table public.subcontractors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  phone text check (phone ~ '^[0-9]{8,15}$'),
  services text[] not null default '{}' check (services <@ array['gypsum', 'interior', 'exterior']::text[]),
  vat_number text check (vat_number ~ '^3[0-9]{13}3$'),
  iban text check (iban ~ '^SA[0-9]{22}$'),
  notes text check (char_length(notes) <= 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.subcontractor_agreements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  subcontractor_id uuid not null references public.subcontractors (id) on delete restrict,
  contract_id uuid not null references public.contracts (id) on delete restrict,
  scope text not null check (char_length(scope) between 2 and 1000),
  basis text not null check (basis in ('lump', 'per_m2')),
  rate numeric(12, 2) not null check (rate >= 0),         -- per m² price, or the lump sum
  quantity_m2 numeric(12, 2) check (quantity_m2 >= 0),     -- agreed area (per m²)
  schedule text not null check (schedule in ('weekly', 'progress')),
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (basis = 'lump' or quantity_m2 is not null)
);
create index subcontractor_agreements_contract_idx on public.subcontractor_agreements (contract_id);

create table public.subcontractor_work (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  agreement_id uuid not null references public.subcontractor_agreements (id) on delete cascade,
  work_date date not null default current_date,
  quantity_m2 numeric(12, 2) check (quantity_m2 > 0),   -- per m²: area executed this time
  percent numeric(5, 2) check (percent > 0 and percent <= 100), -- lump: share of the job done this time
  amount numeric(14, 2) not null check (amount >= 0),   -- earned, computed by the trigger
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index subcontractor_work_agreement_idx on public.subcontractor_work (agreement_id);

create table public.subcontractor_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  agreement_id uuid not null references public.subcontractor_agreements (id) on delete cascade,
  paid_on date not null default current_date,
  amount numeric(14, 2) not null check (amount > 0),
  method text not null default 'transfer' check (method in ('transfer', 'cash', 'cheque')),
  reference text check (char_length(reference) <= 80),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index subcontractor_payments_agreement_idx on public.subcontractor_payments (agreement_id);

-- earned amount is computed here, never trusted from the browser
create or replace function private.price_subcontractor_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.subcontractor_agreements;
begin
  select * into g from public.subcontractor_agreements where id = new.agreement_id;
  if g.basis = 'per_m2' then
    if new.quantity_m2 is null then
      raise exception 'enter the executed area' using errcode = '22023';
    end if;
    new.percent := null;
    new.amount := round(new.quantity_m2 * g.rate, 2);
  else
    if new.percent is null then
      raise exception 'enter the share of the job done' using errcode = '22023';
    end if;
    new.quantity_m2 := null;
    new.amount := round(g.rate * new.percent / 100, 2);
  end if;
  return new;
end;
$$;
create trigger subcontractor_work_price before insert or update on public.subcontractor_work for each row execute function private.price_subcontractor_work();

-- ---------------------------------------------------------------------------
-- Petty cash
-- ---------------------------------------------------------------------------
create table public.petty_cash_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  holder_id uuid not null references auth.users (id) on delete restrict,
  name text not null check (char_length(name) between 2 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, holder_id)
);

create table public.petty_cash_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid not null references public.petty_cash_accounts (id) on delete restrict,
  kind text not null check (kind in ('topup', 'expense', 'return')),
  entry_date date not null default current_date,
  amount numeric(14, 2) not null check (amount > 0),
  contract_id uuid references public.contracts (id) on delete restrict,
  description text not null check (char_length(description) between 1 and 300),
  supplier_name text check (char_length(supplier_name) <= 160),
  attachment_path text check (char_length(attachment_path) <= 300),
  ai_extracted boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  check (kind = 'expense' or contract_id is null)
);
create index petty_cash_entries_account_idx on public.petty_cash_entries (account_id, entry_date desc);
create index petty_cash_entries_contract_idx on public.petty_cash_entries (contract_id);

-- Common triggers --------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['subcontractors', 'subcontractor_agreements', 'petty_cash_accounts'] loop
    execute format('create trigger %1$s_updated_at before update on public.%1$s for each row execute function private.set_updated_at()', t);
  end loop;
  foreach t in array array['subcontractors', 'subcontractor_agreements', 'subcontractor_work', 'subcontractor_payments', 'petty_cash_accounts', 'petty_cash_entries'] loop
    execute format('create trigger %1$s_created_by before insert on public.%1$s for each row execute function private.set_created_by()', t);
    execute format('select private.enable_audit(%L)', 'public.' || t);
  end loop;
end $$;

create or replace function private.check_phase8_refs()
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
  for ref in select * from (values ('subcontractor_id', 'subcontractors'), ('contract_id', 'contracts'), ('agreement_id', 'subcontractor_agreements'),
                                   ('account_id', 'petty_cash_accounts')) as r(col, tbl) loop
    if j ? ref.col and j ->> ref.col is not null then
      execute format('select organization_id from public.%I where id = $1', ref.tbl) into v_org using (j ->> ref.col)::uuid;
      if v_org is distinct from new.organization_id then
        raise exception '% belongs to another organization', ref.col using errcode = '42501';
      end if;
    end if;
  end loop;
  if j ? 'holder_id' and not exists (select 1 from public.memberships m where m.organization_id = new.organization_id and m.user_id = (j ->> 'holder_id')::uuid) then
    raise exception 'the holder must be a member' using errcode = '42501';
  end if;
  if j ? 'attachment_path' and j ->> 'attachment_path' is not null
     and j ->> 'attachment_path' !~ ('^' || new.organization_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$') then
    raise exception 'invalid attachment' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.check_phase8_refs() from public;
grant execute on function private.check_phase8_refs() to authenticated, service_role;
do $$
declare t text;
begin
  foreach t in array array['subcontractor_agreements', 'subcontractor_work', 'subcontractor_payments', 'petty_cash_accounts', 'petty_cash_entries'] loop
    execute format('create trigger %1$s_refs before insert or update on public.%1$s for each row execute function private.check_phase8_refs()', t);
  end loop;
end $$;

-- Petty cash rules: only finance tops up or takes cash back; an expense is logged
-- by the holder (or purchasing staff); entries are a ledger — no edits.
create or replace function private.guard_petty_cash_entry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_holder uuid;
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op <> 'INSERT' then
      raise exception 'petty cash entries can''t be changed — add a correcting entry' using errcode = '42501';
    end if;
    select holder_id into v_holder from public.petty_cash_accounts where id = new.account_id;
    if new.kind in ('topup', 'return') and not private.has_permission(new.organization_id, 'finance.manage') then
      raise exception 'only finance tops up petty cash' using errcode = '42501';
    end if;
    if new.kind = 'expense' and v_holder <> auth.uid() and not private.has_permission(new.organization_id, 'purchases.manage') then
      raise exception 'not your petty cash' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger petty_cash_entries_guard before insert or update or delete on public.petty_cash_entries for each row execute function private.guard_petty_cash_entry();

-- RLS -----------------------------------------------------------------------------
alter table public.subcontractors enable row level security;
alter table public.subcontractor_agreements enable row level security;
alter table public.subcontractor_work enable row level security;
alter table public.subcontractor_payments enable row level security;
alter table public.petty_cash_accounts enable row level security;
alter table public.petty_cash_entries enable row level security;

do $$
declare t text;
begin
  foreach t in array array['subcontractors', 'subcontractor_agreements', 'subcontractor_work'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using ((select private.has_permission(organization_id, 'purchases.view')));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check ((select private.has_permission(organization_id, 'purchases.manage')));
      create policy %1$s_update on public.%1$s for update to authenticated
        using ((select private.has_permission(organization_id, 'purchases.manage')))
        with check ((select private.has_permission(organization_id, 'purchases.manage')));
    $f$, t);
  end loop;
end $$;
create policy subcontractor_work_delete on public.subcontractor_work for delete to authenticated
  using ((select private.has_permission(organization_id, 'purchases.manage')));
-- paying subcontractors is a finance action
create policy subcontractor_payments_select on public.subcontractor_payments for select to authenticated
  using ((select private.has_permission(organization_id, 'purchases.view')) or (select private.has_permission(organization_id, 'finance.view')));
create policy subcontractor_payments_insert on public.subcontractor_payments for insert to authenticated
  with check ((select private.has_permission(organization_id, 'finance.manage')));

create policy petty_cash_accounts_select on public.petty_cash_accounts for select to authenticated
  using (holder_id = (select auth.uid()) and (select private.is_member(organization_id))
         or (select private.has_permission(organization_id, 'finance.view'))
         or (select private.has_permission(organization_id, 'purchases.view')));
create policy petty_cash_accounts_insert on public.petty_cash_accounts for insert to authenticated
  with check ((select private.has_permission(organization_id, 'finance.manage')));
create policy petty_cash_accounts_update on public.petty_cash_accounts for update to authenticated
  using ((select private.has_permission(organization_id, 'finance.manage')))
  with check ((select private.has_permission(organization_id, 'finance.manage')));

create policy petty_cash_entries_select on public.petty_cash_entries for select to authenticated
  using ((select private.has_permission(organization_id, 'finance.view'))
         or (select private.has_permission(organization_id, 'purchases.view'))
         or exists (select 1 from public.petty_cash_accounts a where a.id = account_id and a.holder_id = (select auth.uid())));
create policy petty_cash_entries_insert on public.petty_cash_entries for insert to authenticated
  with check ((select private.is_member(organization_id))
              and exists (select 1 from public.petty_cash_accounts a where a.id = account_id and a.is_active));

revoke all on public.subcontractors, public.subcontractor_agreements, public.subcontractor_work, public.subcontractor_payments,
  public.petty_cash_accounts, public.petty_cash_entries from anon;
grant select, insert, update on public.subcontractors, public.subcontractor_agreements, public.petty_cash_accounts to authenticated;
grant select, insert, update, delete on public.subcontractor_work to authenticated;
grant select, insert on public.subcontractor_payments, public.petty_cash_entries to authenticated;
grant all on public.subcontractors, public.subcontractor_agreements, public.subcontractor_work, public.subcontractor_payments,
  public.petty_cash_accounts, public.petty_cash_entries to service_role;
