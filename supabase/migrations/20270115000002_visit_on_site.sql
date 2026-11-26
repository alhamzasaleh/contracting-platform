-- Project site + check-in only on site (owner, Nov 2026).
-- A project may have its own site pin (project_sites: a client with two villas); otherwise the
-- client's pin is the site. A visit by a signed-in user needs the phone's position, accurate to
-- 150 m, within 300 m of the site — enforced here so no route (app, API) can record a visit from
-- elsewhere. Fixtures / service code (not "authenticated") are not concerned.

create table public.project_sites (
  contract_id uuid primary key references public.contracts (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.project_sites enable row level security;
create policy project_sites_select on public.project_sites for select to authenticated
  using ((select private.has_permission(organization_id, 'projects.view')));
create policy project_sites_write on public.project_sites for all to authenticated
  using ((select private.has_permission(organization_id, 'projects.manage')))
  with check ((select private.has_permission(organization_id, 'projects.manage')));
create policy project_sites_project_scope on public.project_sites as restrictive for all to authenticated
  using (private.can_access_contract(organization_id, contract_id))
  with check (private.can_access_contract(organization_id, contract_id));
grant select, insert, update, delete on public.project_sites to authenticated;
select private.enable_audit('public.project_sites');

-- the pin belongs to the contract's organization
create or replace function private.project_site_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.contracts c where c.id = new.contract_id and c.organization_id = new.organization_id) then
    raise exception 'contract of another organization' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger project_sites_org before insert or update on public.project_sites
  for each row execute function private.project_site_org();

-- the project's site (definer: a supervisor may not see the clients table itself)
create or replace function private.contract_site(p_contract uuid)
returns table (lat numeric, lng numeric)
language sql
stable
security definer
set search_path = ''
as $$
  -- only about a project the caller can see (member of its organization + project access);
  -- the project's own pin, else the client's
  select coalesce(ps.latitude, cl.latitude), coalesce(ps.longitude, cl.longitude)
    from public.contracts c
    join public.clients cl on cl.id = c.client_id
    left join public.project_sites ps on ps.contract_id = c.id
   where c.id = p_contract
     and private.can_access_contract(c.organization_id, c.id);
$$;
revoke all on function private.contract_site(uuid) from public;
grant execute on function private.contract_site(uuid) to authenticated;

-- great-circle distance in metres (as distanceMeters() in src/lib/geo.ts)
create or replace function private.distance_m(a_lat numeric, a_lng numeric, b_lat numeric, b_lng numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(2 * 6371000 * asin(sqrt(
    power(sin(radians((b_lat - a_lat)::float8) / 2), 2)
    + cos(radians(a_lat::float8)) * cos(radians(b_lat::float8)) * power(sin(radians((b_lng - a_lng)::float8) / 2), 2)
  ))::numeric);
$$;

-- invoker: it checks who is inserting (a definer would always run as the owner)
create or replace function private.visit_on_site()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_site record;
  v_m numeric;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  select * into v_site from private.contract_site(new.contract_id);
  if v_site.lat is null or v_site.lng is null then
    raise exception 'project site not set' using errcode = '22023';
  end if;
  if new.latitude is null or new.longitude is null then
    raise exception 'visit needs location' using errcode = '22023';
  end if;
  if new.accuracy_m is null or new.accuracy_m > 150 then
    raise exception 'visit location inaccurate' using errcode = '22023';
  end if;
  v_m := private.distance_m(v_site.lat, v_site.lng, new.latitude, new.longitude);
  if v_m > 300 then
    raise exception 'visit too far:%', v_m using errcode = '22023';
  end if;
  return new;
end;
$$;

-- after site_visits_accepted / site_visits_stamp (triggers fire in name order)
create trigger site_visits_zz_on_site before insert on public.site_visits
  for each row execute function private.visit_on_site();

-- the sites of the projects the caller can see, for the project page and the projects map
-- (projects.view — a supervisor without clients.view still sees where the project is)
create or replace function public.project_site_list(p_org uuid)
returns table (contract_id uuid, latitude numeric, longitude numeric, own boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, coalesce(ps.latitude, cl.latitude), coalesce(ps.longitude, cl.longitude), ps.contract_id is not null
    from public.contracts c
    join public.clients cl on cl.id = c.client_id
    left join public.project_sites ps on ps.contract_id = c.id
   where c.organization_id = p_org
     and private.has_permission(p_org, 'projects.view')
     and private.can_access_contract(p_org, c.id);
$$;
revoke all on function public.project_site_list(uuid) from public, anon;
grant execute on function public.project_site_list(uuid) to authenticated;
