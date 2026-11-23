-- =============================================================================
-- Receipt vouchers (سند قبض) — one numbered, branded voucher for every amount
-- received from a client (contract payments and addenda). Created only by the
-- database when money is recorded; never edited. Visible to staff and on the
-- client page (with the page token).
-- =============================================================================

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
  end
$$;

create table public.client_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null,
  contract_id uuid not null references public.contracts (id) on delete restrict,
  payment_id uuid references public.contract_payments (id) on delete restrict,
  addendum_id uuid references public.addenda (id) on delete restrict,
  label text not null check (char_length(label) between 1 and 200),
  amount numeric(14, 2) not null check (amount > 0),
  paid_on date not null,
  method text check (method in ('transfer', 'cash', 'cheque', 'card')),
  reference text check (char_length(reference) <= 80),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (organization_id, number),
  check ((payment_id is null) <> (addendum_id is null))
);
create index client_receipts_contract_idx on public.client_receipts (contract_id, created_at);

create trigger client_receipts_number before insert on public.client_receipts for each row execute function private.assign_document_number('receipt');
create trigger client_receipts_lock_number before update of number on public.client_receipts for each row execute function private.lock_number();
create trigger client_receipts_created_by before insert on public.client_receipts for each row execute function private.set_created_by();
select private.enable_audit('public.client_receipts');

create or replace function private.receipt_on_contract_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.paid_amount, 0) > coalesce(old.paid_amount, 0) then
    insert into public.client_receipts (organization_id, contract_id, payment_id, label, amount, paid_on, method, reference)
    values (new.organization_id, new.contract_id, new.id, new.label, new.paid_amount - coalesce(old.paid_amount, 0),
            coalesce(new.paid_at, (now() at time zone 'Asia/Riyadh')::date), new.paid_method, new.paid_reference);
  end if;
  return null;
end;
$$;
create trigger contract_payments_receipt after update of paid_amount on public.contract_payments
  for each row execute function private.receipt_on_contract_payment();

create or replace function private.receipt_on_addendum()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.paid_amount, 0) > coalesce(old.paid_amount, 0) then
    insert into public.client_receipts (organization_id, contract_id, addendum_id, label, amount, paid_on)
    values (new.organization_id, new.contract_id, new.id, new.number || ' — ' || new.title, new.paid_amount - coalesce(old.paid_amount, 0),
            coalesce(new.paid_at, (now() at time zone 'Asia/Riyadh')::date));
  end if;
  return null;
end;
$$;
create trigger addenda_receipt after update of paid_amount on public.addenda
  for each row execute function private.receipt_on_addendum();

-- Money already recorded before this feature: one voucher per payment (non-destructive).
insert into public.client_receipts (organization_id, contract_id, payment_id, label, amount, paid_on, method, reference, created_by)
select p.organization_id, p.contract_id, p.id, p.label, p.paid_amount, coalesce(p.paid_at, p.updated_at::date), p.paid_method, p.paid_reference, p.created_by
from public.contract_payments p
where coalesce(p.paid_amount, 0) > 0
order by p.organization_id, coalesce(p.paid_at, p.updated_at::date), p.seq;
insert into public.client_receipts (organization_id, contract_id, addendum_id, label, amount, paid_on, created_by)
select a.organization_id, a.contract_id, a.id, a.number || ' — ' || a.title, a.paid_amount, coalesce(a.paid_at, a.updated_at::date), a.created_by
from public.addenda a
where coalesce(a.paid_amount, 0) > 0;

-- Client page: this contract's vouchers (token checked by hash / expiry / revocation).
create or replace function public.portal_receipts(p_number text, p_token text)
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
    select jsonb_agg(jsonb_build_object('number', r.number, 'label', r.label, 'amount', r.amount, 'paid_on', r.paid_on,
      'method', r.method, 'reference', r.reference, 'created_at', r.created_at) order by r.created_at, r.number)
    from public.client_receipts r where r.contract_id = v_link.contract_id), '[]'::jsonb);
end;
$$;
revoke all on function public.portal_receipts(text, text) from public, anon, authenticated;
grant execute on function public.portal_receipts(text, text) to service_role;

alter table public.client_receipts enable row level security;
create policy client_receipts_select on public.client_receipts for select to authenticated
  using ((select private.has_permission(organization_id, 'finance.view')) or (select private.has_permission(organization_id, 'quotes.view')));
revoke all on public.client_receipts from anon, authenticated;
grant select on public.client_receipts to authenticated;
grant all on public.client_receipts to service_role;
