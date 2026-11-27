-- Subcontractor account (owner, Nov 2026): a number per subcontractor (SC-) and per payment (SP- voucher),
-- a statement of account (built in the app from his agreements, work and payments), and his own page by
-- link + token (/s/<SC-…>/<token>) — same rules as the partner page: token shown once, only its SHA-256
-- stored, revocable, renewable, read only by the server after per-IP rate limiting, a year's validity.

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
    when 'measurement' then 'MS'
    when 'credit_note' then 'CN'
    when 'subcontractor' then 'SC'
    when 'sub_payment' then 'SP'
  end
$$;

-- 1) numbers (existing rows numbered in the order they were made)
alter table public.subcontractors add column number text;
alter table public.subcontractor_payments add column number text;
do $$
declare
  r record;
begin
  for r in select id, organization_id from public.subcontractors where number is null order by created_at, id loop
    update public.subcontractors set number = private.next_document_number(r.organization_id, 'subcontractor') where id = r.id;
  end loop;
  for r in select id, organization_id from public.subcontractor_payments where number is null order by paid_on, created_at, id loop
    update public.subcontractor_payments set number = private.next_document_number(r.organization_id, 'sub_payment') where id = r.id;
  end loop;
end $$;
alter table public.subcontractors alter column number set not null;
alter table public.subcontractor_payments alter column number set not null;
alter table public.subcontractors add constraint subcontractors_org_number_key unique (organization_id, number);
alter table public.subcontractor_payments add constraint subcontractor_payments_org_number_key unique (organization_id, number);
create trigger subcontractors_number before insert on public.subcontractors
  for each row execute function private.assign_document_number('subcontractor');
create trigger subcontractors_lock_number before update of number on public.subcontractors
  for each row execute function private.lock_number();
create trigger subcontractor_payments_number before insert on public.subcontractor_payments
  for each row execute function private.assign_document_number('sub_payment');
create trigger subcontractor_payments_lock_number before update of number on public.subcontractor_payments
  for each row execute function private.lock_number();

-- users never choose the number
create or replace function private.guard_sub_numbers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and tg_op = 'INSERT' and new.number is not null then
    raise exception 'numbers are given by the database' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_sub_numbers() from public;
create trigger subcontractors_a_guard_number before insert on public.subcontractors
  for each row execute function private.guard_sub_numbers();
create trigger subcontractor_payments_a_guard_number before insert on public.subcontractor_payments
  for each row execute function private.guard_sub_numbers();

-- 2) his page links
create table public.subcontractor_portal_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  subcontractor_id uuid not null references public.subcontractors (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index subcontractor_portal_links_sub_idx on public.subcontractor_portal_links (subcontractor_id, created_at desc);
create trigger subcontractor_portal_links_created_by before insert on public.subcontractor_portal_links
  for each row execute function private.set_created_by();
select private.enable_audit('public.subcontractor_portal_links');
alter table public.subcontractor_portal_links enable row level security;
create policy subcontractor_portal_links_select on public.subcontractor_portal_links for select to authenticated
  using ((select private.has_permission(organization_id, 'purchases.manage')));
revoke all on public.subcontractor_portal_links from anon, authenticated;
grant select on public.subcontractor_portal_links to authenticated;
grant all on public.subcontractor_portal_links to service_role;

create or replace function public.issue_subcontractor_link(p_sub uuid, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.subcontractors;
  v_id uuid;
begin
  select * into s from public.subcontractors where id = p_sub for update;
  if s.id is null or not private.has_permission(s.organization_id, 'purchases.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- his page shows every project he works on: only someone who can see all of them may issue it
  if exists (select 1 from public.subcontractor_agreements g where g.subcontractor_id = s.id
             and not private.can_access_contract(g.organization_id, g.contract_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid link' using errcode = '22023';
  end if;
  if not s.is_active then
    raise exception 'subcontractor inactive' using errcode = '22023';
  end if;
  insert into public.subcontractor_portal_links (organization_id, subcontractor_id, token_hash, expires_at)
  values (s.organization_id, s.id, p_token_hash, now() + interval '365 days')
  returning id into v_id;
  update public.subcontractor_portal_links set revoked_at = now() where subcontractor_id = s.id and revoked_at is null and id <> v_id;
  return v_id;
end;
$$;
revoke all on function public.issue_subcontractor_link(uuid, text) from public, anon;
grant execute on function public.issue_subcontractor_link(uuid, text) to authenticated;

create or replace function public.revoke_subcontractor_links(p_sub uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.subcontractors;
  v_count int;
begin
  select * into s from public.subcontractors where id = p_sub;
  if s.id is null or not private.has_permission(s.organization_id, 'purchases.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.subcontractor_agreements g where g.subcontractor_id = s.id
             and not private.can_access_contract(g.organization_id, g.contract_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.subcontractor_portal_links set revoked_at = now() where subcontractor_id = s.id and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.revoke_subcontractor_links(uuid) from public, anon;
grant execute on function public.revoke_subcontractor_links(uuid) to authenticated;

-- a deactivated subcontractor's page closes at once
create or replace function private.subcontractor_deactivated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.is_active and old.is_active then
    update public.subcontractor_portal_links set revoked_at = now() where subcontractor_id = new.id and revoked_at is null;
  end if;
  return null;
end;
$$;
revoke all on function private.subcontractor_deactivated() from public;
create trigger subcontractors_deactivated after update of is_active on public.subcontractors
  for each row execute function private.subcontractor_deactivated();

create or replace function private.subcontractor_link(p_number text, p_token text)
returns public.subcontractor_portal_links
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.subcontractor_portal_links;
begin
  if not private.portal_token_ok(p_token) or p_number is null or char_length(p_number) > 30 then
    return l;
  end if;
  select x.* into l
  from public.subcontractor_portal_links x join public.subcontractors s on s.id = x.subcontractor_id
  where x.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and x.revoked_at is null and x.expires_at > now() and s.number = p_number and s.is_active
  limit 1;
  return l;
end;
$$;
revoke all on function private.subcontractor_link(text, text) from public, anon, authenticated;

-- What he sees: his name and number, and per agreement: the project number, the client's NAME only
-- (no phone / id), the project's city / district, scope, basis, rate, agreed quantity, status, his
-- recorded work and his payments (with voucher numbers). No costs, client prices, margins or others.
create or replace function public.subcontractor_portal_view(p_number text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.subcontractor_portal_links;
  s public.subcontractors;
  o public.organizations;
begin
  l := private.subcontractor_link(p_number, p_token);
  if l.id is null then
    return null;
  end if;
  select * into s from public.subcontractors where id = l.subcontractor_id;
  select * into o from public.organizations where id = l.organization_id;
  return jsonb_build_object(
    'org', jsonb_build_object('id', o.id, 'name', o.name, 'legal_name', o.legal_name, 'phone', o.phone, 'logo_path', o.logo_path, 'brand', o.brand),
    'subcontractor', jsonb_build_object('number', s.number, 'name', s.name),
    'expires_at', l.expires_at,
    'agreements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'contract', c.number, 'client', cl.name, 'city', coalesce(c.site_city, cl.city), 'district', coalesce(c.site_district, cl.district),
        'scope', g.scope, 'basis', g.basis, 'rate', g.rate, 'quantity_m2', g.quantity_m2, 'schedule', g.schedule, 'status', g.status, 'created_at', g.created_at,
        'work', coalesce((select jsonb_agg(jsonb_build_object('work_date', w.work_date, 'quantity_m2', w.quantity_m2, 'percent', w.percent, 'amount', w.amount, 'note', w.note) order by w.work_date, w.created_at)
                          from public.subcontractor_work w where w.agreement_id = g.id), '[]'::jsonb),
        'payments', coalesce((select jsonb_agg(jsonb_build_object('number', p.number, 'paid_on', p.paid_on, 'amount', p.amount, 'method', p.method) order by p.paid_on, p.created_at)
                              from public.subcontractor_payments p where p.agreement_id = g.id), '[]'::jsonb))
        order by g.created_at desc)
      from public.subcontractor_agreements g
      join public.contracts c on c.id = g.contract_id
      join public.clients cl on cl.id = c.client_id
      where g.subcontractor_id = s.id), '[]'::jsonb));
end;
$$;
revoke all on function public.subcontractor_portal_view(text, text) from public, anon, authenticated;
grant execute on function public.subcontractor_portal_view(text, text) to service_role;

-- One of HIS payment vouchers (SP-) for his page's print / PDF: same token checks; anything else → null.
create or replace function public.subcontractor_portal_voucher(p_number text, p_token text, p_voucher text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.subcontractor_portal_links;
  p public.subcontractor_payments;
  g public.subcontractor_agreements;
  o public.organizations;
begin
  l := private.subcontractor_link(p_number, p_token);
  if l.id is null or p_voucher is null or char_length(p_voucher) > 30 then
    return null;
  end if;
  select x.* into p from public.subcontractor_payments x join public.subcontractor_agreements a on a.id = x.agreement_id
  where x.number = p_voucher and x.organization_id = l.organization_id and a.subcontractor_id = l.subcontractor_id;
  if p.id is null then
    return null;
  end if;
  select * into g from public.subcontractor_agreements where id = p.agreement_id;
  select * into o from public.organizations where id = l.organization_id;
  return jsonb_build_object(
    'org', jsonb_build_object('id', o.id, 'name', o.name, 'legal_name', o.legal_name, 'cr_number', o.cr_number, 'vat_number', o.vat_number, 'phone', o.phone,
                              'city', o.city, 'address', o.address, 'signatory_name', o.signatory_name, 'signatory_title', o.signatory_title, 'logo_path', o.logo_path, 'brand', o.brand),
    'voucher', jsonb_build_object('number', p.number, 'paid_on', p.paid_on, 'amount', p.amount, 'method', p.method, 'reference', p.reference, 'note', p.note),
    'subcontractor', (select jsonb_build_object('number', s.number, 'name', s.name, 'iban', s.iban) from public.subcontractors s where s.id = g.subcontractor_id),
    'agreement', (select jsonb_build_object('contract', c.number, 'client', cl.name, 'scope', g.scope)
                  from public.contracts c join public.clients cl on cl.id = c.client_id where c.id = g.contract_id));
end;
$$;
revoke all on function public.subcontractor_portal_voucher(text, text, text) from public, anon, authenticated;
grant execute on function public.subcontractor_portal_voucher(text, text, text) to service_role;
