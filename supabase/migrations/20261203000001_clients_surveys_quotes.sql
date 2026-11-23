-- =============================================================================
-- Phase 3 — Clients → survey → quote
-- clients · surveys · survey_rooms · quotes · quote_versions (append-only,
-- price snapshot) · quote_version_costs (internal costs, costs.view only) ·
-- approvals (margin below minimum / discount)
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
  end
$$;

-- -----------------------------------------------------------------------------
-- Clients
-- -----------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null,
  name text not null check (char_length(name) between 2 and 160),
  phone text check (phone ~ '^[0-9]{8,15}$'),
  city text check (char_length(city) <= 80),
  district text check (char_length(district) <= 80),
  location_url text check (char_length(location_url) <= 500 and location_url ~ '^https://'),
  notes text check (char_length(notes) <= 2000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, number)
);
create index clients_org_idx on public.clients (organization_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Surveys: total areas or room by room (L × W × H)
-- -----------------------------------------------------------------------------
create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null,
  client_id uuid not null references public.clients (id) on delete cascade,
  title text check (char_length(title) <= 160),
  mode text not null default 'rooms' check (mode in ('total', 'rooms')),
  visit_date date,
  -- total mode: areas per service (validated in the app)
  totals jsonb not null default '{}'::jsonb check (jsonb_typeof(totals) = 'object' and pg_column_size(totals) < 16384),
  notes text check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, number)
);
create index surveys_client_idx on public.surveys (client_id);

create table public.survey_rooms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  survey_id uuid not null references public.surveys (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  unit_label text check (char_length(unit_label) <= 60),
  length_m numeric(8, 2) not null check (length_m > 0 and length_m <= 200),
  width_m numeric(8, 2) not null check (width_m > 0 and width_m <= 200),
  height_m numeric(6, 2) not null default 3 check (height_m > 0 and height_m <= 30),
  openings_m2 numeric(8, 2) not null default 0 check (openings_m2 >= 0),
  -- what applies in this room, and its type (one survey serves every service)
  gypsum_ceiling boolean not null default false,
  ceiling_board text not null default 'normal' check (ceiling_board in ('normal', 'moisture', 'fire')),
  paint_walls boolean not null default true,
  paint_ceiling boolean not null default true,
  wall_zone text not null default 'normal' check (wall_zone in ('normal', 'wet', 'decorative')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index survey_rooms_survey_idx on public.survey_rooms (survey_id, sort_order);

-- -----------------------------------------------------------------------------
-- Quotes and their versions (every revision kept; prices frozen)
-- -----------------------------------------------------------------------------
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null,
  client_id uuid not null references public.clients (id) on delete restrict,
  survey_id uuid references public.surveys (id) on delete set null,
  service text not null check (service in ('gypsum', 'interior', 'exterior')),
  title text check (char_length(title) <= 160),
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'issued', 'accepted', 'rejected', 'expired')),
  current_version int not null default 0 check (current_version >= 0),
  valid_until date,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, number)
);
create index quotes_org_idx on public.quotes (organization_id, created_at desc);
create index quotes_client_idx on public.quotes (client_id);

create table public.quote_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  quote_id uuid not null references public.quotes (id) on delete cascade,
  version int not null check (version > 0),
  -- inputs (to reopen exactly) and the client-facing result
  selection jsonb not null check (jsonb_typeof(selection) = 'object' and pg_column_size(selection) < 65536),
  quantities jsonb not null check (jsonb_typeof(quantities) = 'object' and pg_column_size(quantities) < 16384),
  client_view jsonb not null check (jsonb_typeof(client_view) = 'object' and pg_column_size(client_view) < 131072),
  pricing_method text not null default 'unit' check (pricing_method in ('unit', 'lump')),
  estimated boolean not null default false,
  discount numeric(14, 2) not null default 0 check (discount >= 0),
  subtotal numeric(14, 2) not null check (subtotal >= 0),
  vat_percent numeric(5, 2) not null default 0 check (vat_percent between 0 and 100),
  vat numeric(14, 2) not null default 0 check (vat >= 0),
  total numeric(14, 2) not null check (total >= 0),
  notes text check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (quote_id, version)
);

-- Internal: costs, margin and the priced lines (only for costs.view).
create table public.quote_version_costs (
  quote_version_id uuid primary key references public.quote_versions (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  cost numeric(14, 2) not null,
  cost_with_contingency numeric(14, 2) not null,
  margin_percent numeric(6, 2) not null,
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and pg_column_size(lines) < 262144),
  purchase_list jsonb not null default '[]'::jsonb check (jsonb_typeof(purchase_list) = 'array'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

-- -----------------------------------------------------------------------------
-- Approvals (owner decides): margin below minimum, discount, …
-- -----------------------------------------------------------------------------
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('quote_margin', 'quote_discount', 'purchase_limit', 'addendum')),
  entity text not null check (entity in ('quote', 'purchase', 'addendum')),
  entity_id uuid not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) < 8192),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index approvals_pending_idx on public.approvals (organization_id, status, created_at desc);
create index approvals_entity_idx on public.approvals (entity, entity_id);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
create trigger clients_number before insert on public.clients for each row execute function private.assign_document_number('client');
create trigger surveys_number before insert on public.surveys for each row execute function private.assign_document_number('survey');
create trigger quotes_number before insert on public.quotes for each row execute function private.assign_document_number('quote');

do $$
declare t text;
begin
  foreach t in array array['clients', 'surveys', 'survey_rooms', 'quotes', 'approvals'] loop
    execute format('create trigger %1$s_updated_at before update on public.%1$s for each row execute function private.set_updated_at()', t);
  end loop;
  foreach t in array array['clients', 'surveys', 'survey_rooms', 'quotes', 'quote_versions', 'quote_version_costs', 'approvals'] loop
    execute format('create trigger %1$s_created_by before insert on public.%1$s for each row execute function private.set_created_by()', t);
    execute format('select private.enable_audit(%L)', 'public.' || t);
  end loop;
end $$;

-- Numbers are assigned by the database and never change.
create or replace function private.lock_number()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.number is distinct from old.number then
    raise exception 'document numbers cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['clients', 'surveys', 'quotes'] loop
    execute format('create trigger %1$s_lock_number before update of number on public.%1$s for each row execute function private.lock_number()', t);
  end loop;
end $$;

-- Same-organization references.
create or replace function private.check_phase3_refs()
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
  for ref in
    select * from (values ('client_id', 'clients'), ('survey_id', 'surveys'), ('quote_id', 'quotes'), ('quote_version_id', 'quote_versions')) as r(col, tbl)
  loop
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
grant execute on function private.check_phase3_refs() to authenticated, service_role;
do $$
declare t text;
begin
  foreach t in array array['surveys', 'survey_rooms', 'quotes', 'quote_versions', 'quote_version_costs'] loop
    execute format('create trigger %1$s_refs before insert or update on public.%1$s for each row execute function private.check_phase3_refs()', t);
  end loop;
end $$;

-- A new version must be the next number, and the quote's current_version follows.
create or replace function private.next_quote_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_current int;
begin
  select current_version into v_current from public.quotes where id = new.quote_id for update;
  new.version := v_current + 1;
  update public.quotes set current_version = new.version, updated_at = now() where id = new.quote_id;
  return new;
end;
$$;
grant execute on function private.next_quote_version() to authenticated, service_role;
create trigger quote_versions_next before insert on public.quote_versions for each row execute function private.next_quote_version();

-- Approvals: only the decision fields can change, only by someone with approvals.decide.
create or replace function private.guard_approval()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.kind is distinct from old.kind or new.entity is distinct from old.entity or new.entity_id is distinct from old.entity_id
       or new.details is distinct from old.details or new.organization_id is distinct from old.organization_id then
      raise exception 'only the decision can change' using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      new.decided_by := auth.uid();
      new.decided_at := now();
    end if;
  end if;
  return new;
end;
$$;
create trigger approvals_guard before update on public.approvals for each row execute function private.guard_approval();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.clients enable row level security;
alter table public.surveys enable row level security;
alter table public.survey_rooms enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_versions enable row level security;
alter table public.quote_version_costs enable row level security;
alter table public.approvals enable row level security;

do $$
declare t text;
begin
  foreach t in array array['clients', 'surveys', 'survey_rooms'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using ((select private.has_permission(organization_id, 'clients.view')));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check ((select private.has_permission(organization_id, 'clients.manage')));
      create policy %1$s_update on public.%1$s for update to authenticated
        using ((select private.has_permission(organization_id, 'clients.manage')))
        with check ((select private.has_permission(organization_id, 'clients.manage')));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using ((select private.has_permission(organization_id, 'clients.manage')));
    $f$, t);
  end loop;
end $$;

create policy quotes_select on public.quotes for select to authenticated
  using ((select private.has_permission(organization_id, 'quotes.view')));
create policy quotes_insert on public.quotes for insert to authenticated
  with check ((select private.has_permission(organization_id, 'quotes.manage')));
create policy quotes_update on public.quotes for update to authenticated
  using ((select private.has_permission(organization_id, 'quotes.manage')))
  with check ((select private.has_permission(organization_id, 'quotes.manage')));

create policy quote_versions_select on public.quote_versions for select to authenticated
  using ((select private.has_permission(organization_id, 'quotes.view')));
create policy quote_versions_insert on public.quote_versions for insert to authenticated
  with check ((select private.has_permission(organization_id, 'quotes.manage')));

create policy quote_version_costs_select on public.quote_version_costs for select to authenticated
  using ((select private.has_permission(organization_id, 'quotes.view')) and (select private.has_permission(organization_id, 'costs.view')));
create policy quote_version_costs_insert on public.quote_version_costs for insert to authenticated
  with check ((select private.has_permission(organization_id, 'quotes.manage')) and (select private.has_permission(organization_id, 'costs.view')));

create policy approvals_select on public.approvals for select to authenticated
  using ((select private.has_permission(organization_id, 'quotes.view')) or (select private.has_permission(organization_id, 'approvals.decide')));
create policy approvals_insert on public.approvals for insert to authenticated
  with check ((select private.has_permission(organization_id, 'quotes.manage')) and status = 'pending');
create policy approvals_update on public.approvals for update to authenticated
  using ((select private.has_permission(organization_id, 'approvals.decide')))
  with check ((select private.has_permission(organization_id, 'approvals.decide')));

revoke all on public.clients, public.surveys, public.survey_rooms, public.quotes, public.quote_versions, public.quote_version_costs, public.approvals from anon;
grant select, insert, update, delete on public.clients, public.surveys, public.survey_rooms to authenticated;
grant select, insert, update on public.quotes, public.approvals to authenticated;
-- versions are append-only
grant select, insert on public.quote_versions, public.quote_version_costs to authenticated;
revoke update, delete, truncate on public.quote_versions, public.quote_version_costs from authenticated;
grant all on public.clients, public.surveys, public.survey_rooms, public.quotes, public.quote_versions, public.quote_version_costs, public.approvals to service_role;
