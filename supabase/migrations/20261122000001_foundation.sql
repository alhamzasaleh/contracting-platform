-- =============================================================================
-- Phase 1 — Foundation
-- Organizations (multi-tenant root), profiles, memberships & permissions,
-- invitations, delegations, audit log, document numbering, rate limiting,
-- private storage for organization assets.
--
-- Conventions
--   * Every business table carries organization_id, created_at, created_by.
--   * RLS is enabled on EVERY table. Anonymous users get nothing.
--   * Helper functions live in the `private` schema (not exposed by the API),
--     are SECURITY DEFINER with an empty search_path, and are referenced in
--     policies as (select private.fn(...)) so Postgres caches them per query.
-- =============================================================================


create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Anonymous visitors never touch tables directly (the client portal goes
-- through server code with its own token checks).
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;
alter default privileges in schema private revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Fills created_by from the session user when the caller didn't set it.
create or replace function private.set_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

-- Saudi mobile numbers and other E.164 numbers are stored as digits only
-- (no '+'), which is also how Supabase Auth stores phone numbers.
create or replace function private.normalize_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '')
$$;

-- Platform-wide switches (not per organization). Self sign-up stays off
-- until subscriptions/billing exist; the very first organization can always
-- be created (bootstrap).
create table private.platform_settings (
  id boolean primary key default true check (id),
  allow_self_signup boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into private.platform_settings default values;
alter table private.platform_settings enable row level security;

-- -----------------------------------------------------------------------------
-- Organizations
-- -----------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  legal_name text check (char_length(legal_name) <= 200),
  cr_number text check (cr_number ~ '^[0-9]{10}$'),
  vat_number text check (vat_number ~ '^3[0-9]{13}3$'),
  phone text check (phone ~ '^[0-9]{8,15}$'),
  email text check (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  city text check (char_length(city) <= 80),
  address text check (char_length(address) <= 300),
  logo_path text check (char_length(logo_path) <= 300),
  -- Brand palette: {"primary":"#RRGGBB","accent":"#RRGGBB","source":"logo|manual"}
  brand jsonb not null default '{"primary":"#1E4D4A","accent":"#4F6F66","source":"default"}'::jsonb
    check (
      jsonb_typeof(brand) = 'object'
      and brand ->> 'primary' ~ '^#[0-9A-Fa-f]{6}$'
      and (brand ->> 'accent' is null or brand ->> 'accent' ~ '^#[0-9A-Fa-f]{6}$')
    ),
  default_locale text not null default 'ar' check (default_locale in ('ar', 'en')),
  timezone text not null default 'Asia/Riyadh',
  currency text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create trigger organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Profiles (one per auth user) — personal preferences live here.
-- -----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  phone text,
  locale text not null default 'ar' check (locale in ('ar', 'en')),
  numerals text not null default 'latn' check (numerals in ('latn', 'arab')),
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  default_organization_id uuid references public.organizations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, phone, full_name)
  values (
    new.id,
    private.normalize_phone(new.phone),
    nullif(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.handle_user_phone_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set phone = private.normalize_phone(new.phone) where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_phone_changed after update of phone on auth.users
  for each row when (old.phone is distinct from new.phone)
  execute function private.handle_user_phone_change();

-- -----------------------------------------------------------------------------
-- Roles & permissions
-- -----------------------------------------------------------------------------
-- Permission keys are mirrored in src/lib/auth/permissions.ts (a test keeps
-- the two in sync). The database is the source of truth.

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
    'approvals.decide', 'reports.view'
  ]::text[]
$$;

create or replace function private.role_permissions(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'owner' then private.all_permissions()
    when 'supervisor' then array[
      'clients.view', 'clients.manage', 'catalogue.view', 'costs.view',
      'quotes.view', 'quotes.manage', 'projects.view', 'projects.manage',
      'schedule.view', 'schedule.manage', 'purchases.view', 'purchases.manage'
    ]::text[]
    when 'finance' then array[
      'clients.view', 'catalogue.view', 'costs.view', 'quotes.view', 'projects.view',
      'schedule.view', 'purchases.view', 'purchases.manage',
      'finance.view', 'finance.manage', 'reports.view', 'audit.view'
    ]::text[]
    when 'viewer' then array[
      'clients.view', 'quotes.view', 'projects.view', 'schedule.view'
    ]::text[]
    else array[]::text[]
  end
$$;

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'supervisor', 'finance', 'viewer')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  -- {"grant": ["perm", ...], "deny": ["perm", ...]}
  permission_overrides jsonb not null default '{"grant":[],"deny":[]}'::jsonb
    check (
      jsonb_typeof(permission_overrides) = 'object'
      and jsonb_typeof(coalesce(permission_overrides -> 'grant', '[]')) = 'array'
      and jsonb_typeof(coalesce(permission_overrides -> 'deny', '[]')) = 'array'
    ),
  -- 'all' projects, or only projects the member is assigned to (Phase 3+).
  project_scope text not null default 'all' check (project_scope in ('all', 'assigned')),
  -- Max amount (SAR) this member may approve; null = no approval authority
  -- beyond their permissions (owner is unlimited).
  approval_limit numeric(14, 2) check (approval_limit >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index memberships_user_idx on public.memberships (user_id) where status = 'active';

create trigger memberships_updated_at before update on public.memberships
  for each row execute function private.set_updated_at();
create trigger memberships_created_by before insert on public.memberships
  for each row execute function private.set_created_by();

-- Temporary delegation of some permissions from one member to another.
create table public.permission_delegations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  from_user_id uuid not null references auth.users (id) on delete cascade,
  to_user_id uuid not null references auth.users (id) on delete cascade,
  permissions text[] not null check (cardinality(permissions) > 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  reason text check (char_length(reason) <= 300),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  check (ends_at > starts_at),
  check (from_user_id <> to_user_id),
  check (permissions <@ private.all_permissions())
);

create index permission_delegations_to_idx
  on public.permission_delegations (organization_id, to_user_id)
  where revoked_at is null;

create trigger permission_delegations_created_by before insert on public.permission_delegations
  for each row execute function private.set_created_by();

-- Effective permissions from role + overrides (no delegations).
create or replace function private.member_permissions(p_org uuid, p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when m.role = 'owner' then private.all_permissions()
      else array(
        select p from unnest(
          private.role_permissions(m.role)
          || array(select jsonb_array_elements_text(coalesce(m.permission_overrides -> 'grant', '[]')))
        ) as p
        where p = any (private.all_permissions())
        except
        select jsonb_array_elements_text(coalesce(m.permission_overrides -> 'deny', '[]'))
      )
    end
    from public.memberships m
    where m.organization_id = p_org and m.user_id = p_user and m.status = 'active'
  ), array[]::text[])
$$;

create or replace function private.is_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
$$;

create or replace function private.is_owner(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and m.role = 'owner'
      and m.status = 'active'
  )
$$;

-- Role/overrides permissions, plus active delegations. A delegation only
-- passes on what the delegator currently holds, and only to active members.
create or replace function private.has_permission(p_org uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_permission = any (private.member_permissions(p_org, auth.uid()))
    or (
      private.is_member(p_org)
      and exists (
        select 1 from public.permission_delegations d
        where d.organization_id = p_org
          and d.to_user_id = auth.uid()
          and d.revoked_at is null
          and now() >= d.starts_at and now() < d.ends_at
          and p_permission = any (d.permissions)
          and p_permission = any (private.member_permissions(p_org, d.from_user_id))
      )
    )
$$;

create or replace function private.shares_organization(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid() and mine.status = 'active'
      and theirs.user_id = p_user
  )
$$;

-- Guards against privilege escalation and losing the last owner.
-- SECURITY INVOKER on purpose: current_user is 'authenticated' for API calls
-- and the function owner when called from trusted definer functions
-- (create_organization, accept_pending_invitations) or the service role.
create or replace function private.guard_membership_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid := coalesce(new.organization_id, old.organization_id);
  v_actor_is_owner boolean;
  v_actor_perms text[];
  v_requested text[];
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  v_actor_is_owner := private.is_owner(v_org);

  if tg_op = 'UPDATE' and new.organization_id <> old.organization_id then
    raise exception 'membership organization cannot change' using errcode = '42501';
  end if;

  if not v_actor_is_owner then
    -- Only owners touch owner/finance memberships or create them.
    if (tg_op in ('UPDATE', 'DELETE') and old.role in ('owner', 'finance'))
       or (tg_op in ('INSERT', 'UPDATE') and new.role in ('owner', 'finance')) then
      raise exception 'only an owner can manage owner or finance members' using errcode = '42501';
    end if;

    if tg_op in ('INSERT', 'UPDATE') then
      v_actor_perms := private.member_permissions(v_org, v_actor);
      v_requested := private.role_permissions(new.role)
        || array(select jsonb_array_elements_text(coalesce(new.permission_overrides -> 'grant', '[]')));
      if not (v_requested <@ v_actor_perms) then
        raise exception 'cannot grant permissions you do not hold' using errcode = '42501';
      end if;
    end if;
  end if;

  -- An organization must always keep at least one active owner.
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.status <> 'active') then
    if not exists (
      select 1 from public.memberships m
      where m.organization_id = old.organization_id
        and m.role = 'owner' and m.status = 'active' and m.id <> old.id
    ) then
      raise exception 'an organization must keep at least one active owner' using errcode = '23514';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger memberships_guard before insert or update or delete on public.memberships
  for each row execute function private.guard_membership_change();

-- -----------------------------------------------------------------------------
-- Invitations (owner invites a phone number with a role)
-- -----------------------------------------------------------------------------

create table public.member_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{8,15}$'),
  full_name text check (char_length(full_name) <= 120),
  role text not null check (role in ('supervisor', 'finance', 'viewer')),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create unique index member_invitations_pending_uq
  on public.member_invitations (organization_id, phone)
  where accepted_at is null and revoked_at is null;

create trigger member_invitations_created_by before insert on public.member_invitations
  for each row execute function private.set_created_by();

create or replace function private.guard_invitation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.phone := private.normalize_phone(new.phone);
  if current_user in ('authenticated', 'anon') and new.role = 'finance' and not private.is_owner(new.organization_id) then
    raise exception 'only an owner can invite finance members' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger member_invitations_guard before insert or update on public.member_invitations
  for each row execute function private.guard_invitation();

-- -----------------------------------------------------------------------------
-- Audit log — append-only, written by triggers only.
-- -----------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) <= 60),
  table_name text not null check (char_length(table_name) <= 60),
  record_id text check (char_length(record_id) <= 80),
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_org_created_idx on public.audit_log (organization_id, created_at desc);
create index audit_log_record_idx on public.audit_log (table_name, record_id);

create or replace function private.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_org uuid;
begin
  -- Skip no-op updates.
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new;
  end if;

  v_org := case
    when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid
    else (v_row ->> 'organization_id')::uuid
  end;

  insert into public.audit_log (organization_id, actor_id, action, table_name, record_id, before, after)
  values (
    v_org,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    v_row ->> 'id',
    v_old,
    v_new
  );

  return coalesce(new, old);
end;
$$;

-- Attach auditing to a table: select private.enable_audit('public.table');
create or replace function private.enable_audit(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format(
    'create trigger audit_row after insert or update or delete on %s
       for each row execute function private.audit_trigger()',
    p_table
  );
end;
$$;

select private.enable_audit('public.organizations');
select private.enable_audit('public.memberships');
select private.enable_audit('public.member_invitations');
select private.enable_audit('public.permission_delegations');

-- Application-level events (approvals, sign-ins, exports...).
create or replace function public.log_event(
  p_org uuid,
  p_action text,
  p_entity text,
  p_entity_id text,
  p_details jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_member(p_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if char_length(p_action) > 60 or char_length(p_entity) > 60 then
    raise exception 'invalid event' using errcode = '22023';
  end if;
  insert into public.audit_log (organization_id, actor_id, action, table_name, record_id, after)
  values (p_org, auth.uid(), p_action, p_entity, left(p_entity_id, 80), p_details);
end;
$$;

-- -----------------------------------------------------------------------------
-- Document numbering — Q-2026-001 style, per organization per year.
-- The counter row is locked by the upsert, so concurrent transactions
-- serialize; a rolled-back transaction rolls back its increment => no gaps.
-- -----------------------------------------------------------------------------

create table public.document_sequences (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  doc_type text not null check (doc_type ~ '^[a-z_]{2,30}$'),
  year int not null check (year between 2000 and 2200),
  last_value int not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, doc_type, year)
);

create or replace function private.document_prefix(p_doc_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_doc_type
    when 'client' then 'CL'
    when 'request' then 'R'
    when 'quote' then 'Q'
    when 'contract' then 'C'
    when 'project' then 'P'
    when 'purchase' then 'PO'
    when 'invoice' then 'INV'
    when 'addendum' then 'AD'
    when 'maintenance' then 'MR'
  end
$$;

create or replace function private.next_document_number(p_org uuid, p_doc_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text := private.document_prefix(p_doc_type);
  v_year int;
  v_tz text;
  v_value int;
begin
  if v_prefix is null then
    raise exception 'unknown document type %', p_doc_type using errcode = '22023';
  end if;

  select o.timezone into v_tz from public.organizations o where o.id = p_org;
  if v_tz is null then
    raise exception 'organization not found' using errcode = '23503';
  end if;
  v_year := extract(year from now() at time zone v_tz)::int;

  insert into public.document_sequences as s (organization_id, doc_type, year, last_value)
  values (p_org, p_doc_type, v_year, 1)
  on conflict (organization_id, doc_type, year)
  do update set last_value = s.last_value + 1, updated_at = now()
  returning s.last_value into v_value;

  return v_prefix || '-' || v_year || '-' || lpad(v_value::text, greatest(3, length(v_value::text)), '0');
end;
$$;

-- BEFORE INSERT trigger for document tables (Phase 2+):
--   create trigger quotes_number before insert on public.quotes
--     for each row execute function private.assign_document_number('quote');
create or replace function private.assign_document_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.number is null then
    new.number := private.next_document_number(new.organization_id, tg_argv[0]);
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rate limiting (fixed window) for OTP and public endpoints.
-- Only trusted server code (service role) may call it.
-- -----------------------------------------------------------------------------

create table public.rate_limits (
  key text not null check (char_length(key) <= 200),
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);

create or replace function public.check_rate_limit(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  -- Opportunistic cleanup of old windows.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_max;
end;
$$;

-- -----------------------------------------------------------------------------
-- Auth helpers called from the app
-- -----------------------------------------------------------------------------

-- May this phone number receive a login code? Prevents strangers from
-- creating accounts (and burning SMS credit) before self sign-up exists.
create or replace function public.auth_phone_allowed(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from auth.users u where private.normalize_phone(u.phone) = private.normalize_phone(p_phone))
    or exists (
      select 1 from public.member_invitations i
      where i.phone = private.normalize_phone(p_phone)
        and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    )
    or not exists (select 1 from public.organizations)
    or (select s.allow_self_signup from private.platform_settings s)
$$;

-- First owner creates the organization (bootstrap), or anyone once self
-- sign-up is switched on for the SaaS.
create or replace function public.create_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.organizations)
     and not (select s.allow_self_signup from private.platform_settings s) then
    raise exception 'organization sign-up is closed' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'organization name is required' using errcode = '22023';
  end if;

  -- Serialize bootstrap so two first users cannot both become owners.
  perform pg_advisory_xact_lock(hashtext('create_organization'));
  if exists (select 1 from public.organizations)
     and not (select s.allow_self_signup from private.platform_settings s) then
    raise exception 'organization sign-up is closed' using errcode = '42501';
  end if;

  insert into public.organizations (name, created_by)
  values (trim(p_name), v_user)
  returning id into v_org;

  insert into public.memberships (organization_id, user_id, role, created_by)
  values (v_org, v_user, 'owner', v_user);

  update public.profiles set default_organization_id = v_org
  where id = v_user and default_organization_id is null;

  return v_org;
end;
$$;

-- Can the signed-in user create an organization right now? (bootstrap/sign-up open)
create or replace function public.can_create_organization()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    not exists (select 1 from public.organizations)
    or (select s.allow_self_signup from private.platform_settings s)
  )
$$;

-- Turns pending invitations for the signed-in phone into memberships.
create or replace function public.accept_pending_invitations()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_phone text;
  v_count int := 0;
  r record;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select private.normalize_phone(u.phone) into v_phone from auth.users u where u.id = v_user;
  if v_phone is null then
    return 0;
  end if;

  for r in
    select * from public.member_invitations i
    where i.phone = v_phone and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    for update
  loop
    insert into public.memberships (organization_id, user_id, role, created_by)
    values (r.organization_id, v_user, r.role, r.created_by)
    on conflict (organization_id, user_id) do nothing;

    update public.member_invitations
      set accepted_at = now(), accepted_by = v_user
      where id = r.id;

    update public.profiles
      set default_organization_id = coalesce(default_organization_id, r.organization_id),
          full_name = coalesce(full_name, r.full_name)
      where id = v_user;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Permissions of the signed-in user in an organization (for UI gating;
-- the database still enforces everything through RLS).
create or replace function public.my_permissions(p_org uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select distinct p from (
      select unnest(private.member_permissions(p_org, auth.uid())) as p
      union
      select unnest(d.permissions)
      from public.permission_delegations d
      where private.is_member(p_org)
        and d.organization_id = p_org and d.to_user_id = auth.uid()
        and d.revoked_at is null and now() >= d.starts_at and now() < d.ends_at
    ) x
    where private.has_permission(p_org, p)
    order by 1
  )
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.permission_delegations enable row level security;
alter table public.member_invitations enable row level security;
alter table public.audit_log enable row level security;
alter table public.document_sequences enable row level security;
alter table public.rate_limits enable row level security;

-- organizations
create policy organizations_select on public.organizations
  for select to authenticated using ((select private.is_member(id)));
create policy organizations_update on public.organizations
  for update to authenticated
  using ((select private.has_permission(id, 'settings.manage')))
  with check ((select private.has_permission(id, 'settings.manage')));
-- insert only through create_organization(); no delete from the app.

-- profiles
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.shares_organization(id)));
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- memberships
create policy memberships_select on public.memberships
  for select to authenticated using ((select private.is_member(organization_id)));
create policy memberships_insert on public.memberships
  for insert to authenticated
  with check ((select private.has_permission(organization_id, 'members.manage')));
create policy memberships_update on public.memberships
  for update to authenticated
  using ((select private.has_permission(organization_id, 'members.manage')))
  with check ((select private.has_permission(organization_id, 'members.manage')));
create policy memberships_delete on public.memberships
  for delete to authenticated
  using ((select private.has_permission(organization_id, 'members.manage')));

-- permission_delegations
create policy delegations_select on public.permission_delegations
  for select to authenticated
  using (
    (select private.is_member(organization_id))
    and (
      from_user_id = (select auth.uid()) or to_user_id = (select auth.uid())
      or (select private.has_permission(organization_id, 'members.manage'))
    )
  );
create policy delegations_insert on public.permission_delegations
  for insert to authenticated
  with check (
    from_user_id = (select auth.uid())
    and (select private.is_member(organization_id))
    and permissions <@ private.member_permissions(organization_id, (select auth.uid()))
    and exists (
      select 1 from public.memberships m
      where m.organization_id = permission_delegations.organization_id
        and m.user_id = permission_delegations.to_user_id and m.status = 'active'
    )
  );
create policy delegations_update on public.permission_delegations
  for update to authenticated
  using (
    from_user_id = (select auth.uid())
    or (select private.has_permission(organization_id, 'members.manage'))
  )
  with check (
    from_user_id = (select auth.uid())
    or (select private.has_permission(organization_id, 'members.manage'))
  );

-- member_invitations
create policy invitations_all on public.member_invitations
  for all to authenticated
  using ((select private.has_permission(organization_id, 'members.manage')))
  with check ((select private.has_permission(organization_id, 'members.manage')));

-- audit_log: read-only for auditors; written by definer triggers only.
create policy audit_log_select on public.audit_log
  for select to authenticated
  using ((select private.has_permission(organization_id, 'audit.view')));

-- document_sequences, rate_limits: no policies => no direct access.

-- -----------------------------------------------------------------------------
-- Privileges (defence in depth on top of RLS)
-- -----------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

revoke all on public.audit_log, public.document_sequences, public.rate_limits from authenticated;
grant select on public.audit_log to authenticated;

revoke update on public.profiles from authenticated;
grant update (full_name, locale, numerals, theme, default_organization_id) on public.profiles to authenticated;

revoke update on public.organizations from authenticated;
grant update (name, legal_name, cr_number, vat_number, phone, email, city, address, logo_path, brand, default_locale)
  on public.organizations to authenticated;
revoke insert, delete on public.organizations from authenticated;
revoke insert, delete on public.profiles from authenticated;

revoke update on public.memberships from authenticated;
grant update (role, status, permission_overrides, project_scope, approval_limit) on public.memberships to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
grant execute on function public.create_organization(text) to authenticated;
grant execute on function public.accept_pending_invitations() to authenticated;
grant execute on function public.can_create_organization() to authenticated;
grant execute on function public.my_permissions(uuid) to authenticated;
grant execute on function public.log_event(uuid, text, text, text, jsonb) to authenticated;
revoke execute on function public.check_rate_limit(text, int, int) from authenticated;
revoke execute on function public.auth_phone_allowed(text) from authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;
grant execute on function public.auth_phone_allowed(text) to service_role;

-- Internal-only functions: not callable by signed-in users directly.
revoke execute on function private.next_document_number(uuid, text) from authenticated;
revoke execute on function private.enable_audit(regclass) from authenticated;

-- -----------------------------------------------------------------------------
-- Storage — private bucket for organization assets (logo, letterheads).
-- Paths: <organization_id>/<file>
-- -----------------------------------------------------------------------------

-- Organization id from the first path segment, or null if it isn't a uuid.
create or replace function private.storage_object_org(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 1)::uuid
  end
$$;
grant execute on function private.storage_object_org(text) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-assets', 'org-assets', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

create policy org_assets_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'org-assets'
    and (select private.is_member(private.storage_object_org(name)))
  );
create policy org_assets_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'org-assets'
    and (select private.has_permission(private.storage_object_org(name), 'settings.manage'))
  );
create policy org_assets_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'org-assets'
    and (select private.has_permission(private.storage_object_org(name), 'settings.manage'))
  );
create policy org_assets_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'org-assets'
    and (select private.has_permission(private.storage_object_org(name), 'settings.manage'))
  );
