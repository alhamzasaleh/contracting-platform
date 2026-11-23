-- =============================================================================
-- Phase 4 — Contracts, payment schedule, client page (portal) links
--   contracts (C-YYYY-NNN) from a quote version, with start date, project type,
--   warranty and a payment schedule; client_portal_links with a HASHED token
--   (never stored in clear), expiry and revocation; two SECURITY DEFINER
--   functions for the public client page, callable only by the server
--   (service role) behind rate limiting.
-- =============================================================================

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null,
  quote_id uuid not null references public.quotes (id) on delete restrict,
  quote_version int not null check (quote_version > 0),
  client_id uuid not null references public.clients (id) on delete restrict,
  service text not null check (service in ('gypsum', 'interior', 'exterior')),
  project_type text not null default 'full' check (project_type in ('full', 'labour', 'supply')),
  start_date date not null,
  duration_days int not null check (duration_days between 1 and 3650),
  warranty_months int not null default 6 check (warranty_months between 0 and 120),
  total numeric(14, 2) not null check (total >= 0),
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'cancelled')),
  notes text check (char_length(notes) <= 4000),
  accepted_at timestamptz,
  accepted_name text check (char_length(accepted_name) <= 160),
  accepted_ip text check (char_length(accepted_ip) <= 64),
  accepted_user_agent text check (char_length(accepted_user_agent) <= 400),
  -- optional drawn signature (SVG/PNG data URL), size-limited
  accepted_signature text check (char_length(accepted_signature) <= 200000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, number)
);
create index contracts_org_idx on public.contracts (organization_id, created_at desc);
create unique index contracts_one_active_per_quote on public.contracts (quote_id) where status <> 'cancelled';

create table public.contract_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  seq int not null check (seq between 1 and 50),
  label text not null check (char_length(label) between 1 and 120),
  percent numeric(6, 3) not null check (percent > 0 and percent <= 100),
  amount numeric(14, 2) not null check (amount >= 0),
  due_event text not null default 'custom' check (due_event in ('signing', 'material_supply', 'board_closing', 'primer_done', 'handover', 'custom')),
  status text not null default 'pending' check (status in ('pending', 'requested', 'paid')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (contract_id, seq)
);

create table public.client_portal_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  -- sha256(token) in hex; the token itself is shown once and never stored
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_opened_at timestamptz,
  open_count int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index client_portal_links_contract_idx on public.client_portal_links (contract_id);

-- Triggers ------------------------------------------------------------------------
create trigger contracts_number before insert on public.contracts for each row execute function private.assign_document_number('contract');
create trigger contracts_lock_number before update of number on public.contracts for each row execute function private.lock_number();
do $$
declare t text;
begin
  foreach t in array array['contracts', 'contract_payments'] loop
    execute format('create trigger %1$s_updated_at before update on public.%1$s for each row execute function private.set_updated_at()', t);
  end loop;
  foreach t in array array['contracts', 'contract_payments', 'client_portal_links'] loop
    execute format('create trigger %1$s_created_by before insert on public.%1$s for each row execute function private.set_created_by()', t);
    execute format('select private.enable_audit(%L)', 'public.' || t);
  end loop;
end $$;

create or replace function private.check_phase4_refs()
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
  for ref in select * from (values ('quote_id', 'quotes'), ('client_id', 'clients'), ('contract_id', 'contracts')) as r(col, tbl) loop
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
grant execute on function private.check_phase4_refs() to authenticated, service_role;
do $$
declare t text;
begin
  foreach t in array array['contracts', 'contract_payments', 'client_portal_links'] loop
    execute format('create trigger %1$s_refs before insert or update on public.%1$s for each row execute function private.check_phase4_refs()', t);
  end loop;
end $$;

-- What the client accepted can't be changed by staff afterwards.
create or replace function private.guard_contract()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if old.status = 'accepted' and (
      new.total is distinct from old.total or new.start_date is distinct from old.start_date
      or new.project_type is distinct from old.project_type or new.quote_version is distinct from old.quote_version
      or new.warranty_months is distinct from old.warranty_months or new.duration_days is distinct from old.duration_days
    ) then
      raise exception 'an accepted contract cannot change' using errcode = '42501';
    end if;
    if new.accepted_at is distinct from old.accepted_at or new.accepted_name is distinct from old.accepted_name
       or new.accepted_ip is distinct from old.accepted_ip or new.accepted_signature is distinct from old.accepted_signature
       or (new.status = 'accepted' and old.status <> 'accepted') then
      raise exception 'only the client can accept' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger contracts_guard before update on public.contracts for each row execute function private.guard_contract();

-- RLS -----------------------------------------------------------------------------
alter table public.contracts enable row level security;
alter table public.contract_payments enable row level security;
alter table public.client_portal_links enable row level security;

do $$
declare t text;
begin
  foreach t in array array['contracts', 'contract_payments'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using ((select private.has_permission(organization_id, 'quotes.view')));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check ((select private.has_permission(organization_id, 'quotes.manage')));
      create policy %1$s_update on public.%1$s for update to authenticated
        using ((select private.has_permission(organization_id, 'quotes.manage')))
        with check ((select private.has_permission(organization_id, 'quotes.manage')));
    $f$, t);
  end loop;
end $$;
create policy contract_payments_delete on public.contract_payments for delete to authenticated
  using ((select private.has_permission(organization_id, 'quotes.manage'))
         and exists (select 1 from public.contracts c where c.id = contract_id and c.status in ('draft', 'sent')));

create policy client_portal_links_select on public.client_portal_links for select to authenticated
  using ((select private.has_permission(organization_id, 'quotes.view')));
create policy client_portal_links_insert on public.client_portal_links for insert to authenticated
  with check ((select private.has_permission(organization_id, 'quotes.manage')));
create policy client_portal_links_update on public.client_portal_links for update to authenticated
  using ((select private.has_permission(organization_id, 'quotes.manage')))
  with check ((select private.has_permission(organization_id, 'quotes.manage')));

revoke all on public.contracts, public.contract_payments, public.client_portal_links from anon;
grant select, insert, update on public.contracts, public.client_portal_links to authenticated;
grant select, insert, update, delete on public.contract_payments to authenticated;
grant all on public.contracts, public.contract_payments, public.client_portal_links to service_role;

-- -----------------------------------------------------------------------------
-- Public client page: two functions, callable ONLY by the server (service role)
-- after rate limiting. The token is checked by its hash, expiry and revocation.
-- -----------------------------------------------------------------------------

create or replace function private.portal_link(p_number text, p_token text)
returns public.client_portal_links
language sql
stable
security definer
set search_path = ''
as $$
  select l.*
  from public.client_portal_links l
  join public.contracts c on c.id = l.contract_id
  where c.number = p_number
    and l.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and l.revoked_at is null
    and l.expires_at > now()
    and c.status <> 'cancelled'
  limit 1
$$;
revoke execute on function private.portal_link(text, text) from public, anon, authenticated;

create or replace function public.portal_view(p_number text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
  v_out jsonb;
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 100 or p_number is null or char_length(p_number) > 30 then
    return null;
  end if;
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null then
    return null;
  end if;
  update public.client_portal_links set last_opened_at = now(), open_count = open_count + 1 where id = v_link.id;

  select jsonb_build_object(
    'org', jsonb_build_object('name', o.name, 'legal_name', o.legal_name, 'cr_number', o.cr_number, 'vat_number', o.vat_number,
                              'phone', o.phone, 'city', o.city, 'logo_path', o.logo_path, 'brand', o.brand),
    'client', jsonb_build_object('name', cl.name, 'phone', cl.phone, 'city', cl.city),
    'contract', jsonb_build_object('number', c.number, 'status', c.status, 'service', c.service, 'project_type', c.project_type,
                                   'start_date', c.start_date, 'duration_days', c.duration_days, 'warranty_months', c.warranty_months,
                                   'total', c.total, 'notes', c.notes, 'accepted_at', c.accepted_at, 'accepted_name', c.accepted_name),
    'quote', jsonb_build_object('number', q.number, 'version', v.version, 'date', v.created_at, 'valid_until', q.valid_until,
                                'client_view', v.client_view, 'notes', v.notes),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('seq', p.seq, 'label', p.label, 'percent', p.percent, 'amount', p.amount,
                                                              'due_event', p.due_event, 'status', p.status) order by p.seq)
                          from public.contract_payments p where p.contract_id = c.id), '[]'::jsonb),
    'expires_at', v_link.expires_at
  ) into v_out
  from public.contracts c
  join public.organizations o on o.id = c.organization_id
  join public.clients cl on cl.id = c.client_id
  join public.quotes q on q.id = c.quote_id
  join public.quote_versions v on v.quote_id = q.id and v.version = c.quote_version
  where c.id = v_link.contract_id;
  return v_out;
end;
$$;

create or replace function public.portal_accept(p_number text, p_token text, p_name text, p_signature text, p_ip text, p_user_agent text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
  v_contract uuid;
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 100 then
    return false;
  end if;
  if p_name is null or char_length(trim(p_name)) < 2 or char_length(p_name) > 160 then
    raise exception 'name required' using errcode = '22023';
  end if;
  if p_signature is not null and (char_length(p_signature) > 200000 or p_signature !~ '^data:image/(png|svg\+xml);base64,') then
    raise exception 'invalid signature' using errcode = '22023';
  end if;
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null then
    return false;
  end if;
  update public.contracts
  set status = 'accepted', accepted_at = now(), accepted_name = trim(p_name), accepted_signature = p_signature,
      accepted_ip = left(p_ip, 64), accepted_user_agent = left(p_user_agent, 400)
  where id = v_link.contract_id and status = 'sent'
  returning id into v_contract;
  if v_contract is null then
    return false;
  end if;
  update public.quotes q set status = 'accepted'
  from public.contracts c where c.id = v_contract and q.id = c.quote_id;
  insert into public.audit_log (organization_id, actor_id, action, table_name, record_id, after)
  select c.organization_id, null, 'client_accept', 'contracts', c.id::text,
         jsonb_build_object('name', trim(p_name), 'ip', left(p_ip, 64), 'signed', p_signature is not null)
  from public.contracts c where c.id = v_contract;
  return true;
end;
$$;

revoke execute on function public.portal_view(text, text) from public, anon, authenticated;
revoke execute on function public.portal_accept(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.portal_view(text, text) to service_role;
grant execute on function public.portal_accept(text, text, text, text, text, text) to service_role;
