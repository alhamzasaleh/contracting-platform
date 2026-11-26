-- The survey keeps its own site (owner, Nov 2026): booked before the visit with a time and either
-- «the client's site» (pin null) or «another site» (a second villa: its pin, city and district).
-- A project's site = its own pin, else its survey's (contract → quote → survey), else the client's.
-- Non-destructive.
alter table public.surveys
  add column if not exists visit_time time,
  add column if not exists latitude numeric(9, 6) check (latitude between -90 and 90),
  add column if not exists longitude numeric(9, 6) check (longitude between -180 and 180),
  add column if not exists site_city text check (char_length(site_city) <= 80),
  add column if not exists site_district text check (char_length(site_district) <= 80);
alter table public.surveys drop constraint if exists surveys_pin_pair;
alter table public.surveys add constraint surveys_pin_pair check ((latitude is null) = (longitude is null));
comment on column public.surveys.latitude is 'the survey''s own site (with longitude); null = the client''s site';
comment on column public.surveys.visit_time is 'booked visit time (with visit_date)';

-- the project's site: its own pin, else its survey's, else the client's (pairs are never mixed)
create or replace function private.contract_site(p_contract uuid)
returns table (lat numeric, lng numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(ps.latitude, sv.latitude, cl.latitude), coalesce(ps.longitude, sv.longitude, cl.longitude)
    from public.contracts c
    join public.clients cl on cl.id = c.client_id
    left join public.quotes q on q.id = c.quote_id
    left join public.surveys sv on sv.id = q.survey_id
    left join public.project_sites ps on ps.contract_id = c.id
   where c.id = p_contract
     and private.can_access_contract(c.organization_id, c.id);
$$;
revoke all on function private.contract_site(uuid) from public;
grant execute on function private.contract_site(uuid) to authenticated;

drop function if exists public.project_site_list(uuid);
create function public.project_site_list(p_org uuid)
returns table (contract_id uuid, latitude numeric, longitude numeric, own boolean, source text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id,
         coalesce(ps.latitude, sv.latitude, cl.latitude),
         coalesce(ps.longitude, sv.longitude, cl.longitude),
         ps.contract_id is not null,
         case when ps.contract_id is not null then 'project'
              when sv.latitude is not null then 'survey'
              when cl.latitude is not null then 'client' end
    from public.contracts c
    join public.clients cl on cl.id = c.client_id
    left join public.quotes q on q.id = c.quote_id
    left join public.surveys sv on sv.id = q.survey_id
    left join public.project_sites ps on ps.contract_id = c.id
   where c.organization_id = p_org
     and private.has_permission(p_org, 'projects.view')
     and private.can_access_contract(p_org, c.id);
$$;
revoke all on function public.project_site_list(uuid) from public, anon;
grant execute on function public.project_site_list(uuid) to authenticated;
