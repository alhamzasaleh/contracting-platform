-- =============================================================================
-- Invoices (INV-) — the app issues them now; Qoyod receives them (same number)
-- once connected.
--   One invoice per contract payment the moment it is requested (or paid), and
--   one per accepted addendum. Seller and buyer are snapshotted at issue; amounts
--   come from the frozen schedule. Created only by the database, never edited.
--   "Tax invoice" only when the company had a VAT number at issue (§3.3);
--   otherwise a plain invoice with no VAT.
-- =============================================================================

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null,
  contract_id uuid not null references public.contracts (id) on delete restrict,
  payment_id uuid unique references public.contract_payments (id) on delete restrict,
  addendum_id uuid unique references public.addenda (id) on delete restrict,
  kind text not null check (kind in ('tax', 'simple')),
  issue_date date not null,
  due_date date not null,
  description text not null check (char_length(description) between 1 and 300),
  seller jsonb not null check (jsonb_typeof(seller) = 'object'),
  buyer jsonb not null check (jsonb_typeof(buyer) = 'object'),
  subtotal numeric(14, 2) not null check (subtotal >= 0),
  vat_percent numeric(5, 2) not null default 0 check (vat_percent between 0 and 100),
  vat numeric(14, 2) not null default 0 check (vat >= 0),
  total numeric(14, 2) not null check (total >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (organization_id, number),
  check ((payment_id is null) <> (addendum_id is null)),
  check (abs(subtotal + vat - total) <= 0.02)
);
create index invoices_org_idx on public.invoices (organization_id, issue_date desc);
create index invoices_contract_idx on public.invoices (contract_id);

create trigger invoices_number before insert on public.invoices for each row execute function private.assign_document_number('invoice');
create trigger invoices_lock_number before update of number on public.invoices for each row execute function private.lock_number();
create trigger invoices_created_by before insert on public.invoices for each row execute function private.set_created_by();
select private.enable_audit('public.invoices');

-- Issue one invoice for a payment or an addendum (idempotent).
create or replace function private.issue_invoice(p_payment uuid, p_addendum uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.contracts;
  o public.organizations;
  cl public.clients;
  v_gross numeric;
  v_vat_pct numeric := 0;
  v_desc text;
  v_issue date := (now() at time zone 'Asia/Riyadh')::date;
  v_due date;
  v_net numeric;
  p public.contract_payments;
  a public.addenda;
begin
  if p_payment is not null then
    if exists (select 1 from public.invoices where payment_id = p_payment) then return; end if;
    select * into p from public.contract_payments where id = p_payment;
    select * into c from public.contracts where id = p.contract_id;
    select coalesce(qv.vat_percent, 0) into v_vat_pct from public.quote_versions qv where qv.quote_id = c.quote_id and qv.version = c.quote_version;
    v_gross := p.amount;
    v_desc := p.label;
    v_issue := coalesce((p.requested_at at time zone 'Asia/Riyadh')::date, p.paid_at, v_issue);
    v_due := greatest(coalesce(p.expected_date, v_issue), v_issue);
  else
    if exists (select 1 from public.invoices where addendum_id = p_addendum) then return; end if;
    select * into a from public.addenda where id = p_addendum;
    select * into c from public.contracts where id = a.contract_id;
    v_vat_pct := coalesce(a.vat_percent, 0);
    v_gross := a.total;
    v_desc := a.number || ' — ' || a.title;
    v_issue := coalesce((a.accepted_at at time zone 'Asia/Riyadh')::date, v_issue);
    v_due := v_issue;
  end if;
  if c.id is null or v_gross is null or v_gross <= 0 then return; end if;
  select * into o from public.organizations where id = c.organization_id;
  select * into cl from public.clients where id = c.client_id;
  if o.vat_number is null then
    v_vat_pct := 0;
  end if;
  v_net := round(v_gross / (1 + v_vat_pct / 100), 2);
  insert into public.invoices (organization_id, contract_id, payment_id, addendum_id, kind, issue_date, due_date, description, seller, buyer,
                               subtotal, vat_percent, vat, total)
  values (c.organization_id, c.id, p_payment, p_addendum,
          case when o.vat_number is not null and v_vat_pct > 0 then 'tax' else 'simple' end,
          v_issue, v_due, left(v_desc, 300),
          jsonb_build_object('name', o.name, 'legal_name', o.legal_name, 'cr_number', o.cr_number, 'vat_number', o.vat_number,
                             'address', o.address, 'city', o.city, 'phone', o.phone),
          jsonb_build_object('name', cl.name, 'id_number', cl.id_number, 'phone', cl.phone, 'city', cl.city, 'district', cl.district),
          v_net, v_vat_pct, round(v_gross - v_net, 2), round(v_gross, 2));
end;
$$;
revoke all on function private.issue_invoice(uuid, uuid) from public;

create or replace function private.invoice_on_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('requested', 'paid') then
    perform private.issue_invoice(new.id, null);
  end if;
  return null;
end;
$$;
create trigger contract_payments_invoice after update of status on public.contract_payments
  for each row execute function private.invoice_on_payment();

create or replace function private.invoice_on_addendum()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    perform private.issue_invoice(null, new.id);
  end if;
  return null;
end;
$$;
create trigger addenda_invoice after update of status on public.addenda
  for each row execute function private.invoice_on_addendum();

-- Payments already requested or paid, and accepted addenda (non-destructive).
do $$
declare r record;
begin
  for r in select id from public.contract_payments where status in ('requested', 'paid') order by coalesce(requested_at, updated_at) loop
    perform private.issue_invoice(r.id, null);
  end loop;
  for r in select id from public.addenda where status = 'accepted' order by accepted_at loop
    perform private.issue_invoice(null, r.id);
  end loop;
end $$;

-- Client page: this contract's invoices (token checked) + whether Qoyod's official PDF exists.
create or replace function public.portal_invoice_docs(p_number text, p_token text)
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
    select jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'kind', i.kind, 'issue_date', i.issue_date, 'due_date', i.due_date,
      'description', i.description, 'seller', i.seller, 'buyer', i.buyer, 'subtotal', i.subtotal, 'vat_percent', i.vat_percent, 'vat', i.vat,
      'total', i.total, 'created_at', i.created_at,
      'paid', coalesce(p.paid_amount, a.paid_amount, 0),
      'official', case when i.payment_id is not null then 'p' || p.seq else a.number end,
      'has_official', exists (select 1 from public.qoyod_sync_jobs j where j.entity_id = coalesce(i.payment_id, i.addendum_id) and j.kind = 'invoice' and j.status = 'done' and j.qoyod_id is not null))
      order by i.issue_date, i.number)
    from public.invoices i
    left join public.contract_payments p on p.id = i.payment_id
    left join public.addenda a on a.id = i.addendum_id
    where i.contract_id = v_link.contract_id), '[]'::jsonb);
end;
$$;
revoke all on function public.portal_invoice_docs(text, text) from public, anon, authenticated;
grant execute on function public.portal_invoice_docs(text, text) to service_role;

alter table public.invoices enable row level security;
create policy invoices_select on public.invoices for select to authenticated
  using ((select private.has_permission(organization_id, 'finance.view')) or (select private.has_permission(organization_id, 'quotes.view')));
revoke all on public.invoices from anon, authenticated;
grant select on public.invoices to authenticated;
grant all on public.invoices to service_role;
