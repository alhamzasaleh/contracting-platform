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
  -- the survey's pin counts only until the contract is accepted (then it was copied to project_sites)
  select coalesce(ps.latitude, case when c.status in ('draft', 'sent') then sv.latitude end, cl.latitude),
         coalesce(ps.longitude, case when c.status in ('draft', 'sent') then sv.longitude end, cl.longitude)
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

-- public.project_site_list: see (c) below (with the source and the place)

-- ---------------------------------------------------------------------------------------------
-- Linked to the rest (review, Nov 2026):
-- (a) the contract says where the project is: contracts.site_city / site_district = its survey's
--     place when the survey has its own site (set by the DB only: on insert, and while draft/sent
--     when the survey's site changes; frozen once accepted). Shown in the contract and on the
--     client page (client.site_city / site_district in portal_view).
-- (b) on acceptance the survey's pin is copied to the project (project_sites.from_survey), so moving
--     the survey later never moves a running project's check-in circle.
-- (c) project_site_list also returns the project's place (city / district).
alter table public.contracts
  add column if not exists site_city text check (char_length(site_city) <= 80),
  add column if not exists site_district text check (char_length(site_district) <= 80);
alter table public.project_sites
  add column if not exists from_survey boolean not null default false,
  -- the survey's pin copied at acceptance (kept when a project pin replaces it, for «back»)
  add column if not exists survey_latitude numeric(9, 6),
  add column if not exists survey_longitude numeric(9, 6);
alter table public.contracts add column if not exists site_own boolean not null default false;
comment on column public.contracts.site_own is 'its survey has its own site (set by the database): the place is site_city/site_district, never the client''s address';

-- the survey's own place (null when it is at the client's site)
create or replace function private.quote_site_place(p_quote uuid)
returns table (city text, district text)
language sql
stable
security definer
set search_path = ''
as $$
  -- one row when the quote's survey has its own site (names may be empty), none otherwise
  select sv.site_city, sv.site_district
    from public.quotes q
    join public.surveys sv on sv.id = q.survey_id
   where q.id = p_quote and sv.latitude is not null;
$$;
revoke all on function private.quote_site_place(uuid) from public, anon, authenticated;

create or replace function private.contract_site_place()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  -- users never write the place: the database takes it from the survey
  select * into r from private.quote_site_place(new.quote_id);
  new.site_own := found;
  new.site_city := r.city;
  new.site_district := r.district;
  return new;
end;
$$;
drop trigger if exists contracts_site_place on public.contracts;
create trigger contracts_site_place before insert or update of quote_id on public.contracts
  for each row execute function private.contract_site_place();

-- users can't change it afterwards (only the survey trigger below, while draft/sent)
create or replace function private.guard_contract_site_place()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and new.quote_id is not distinct from old.quote_id
     and (new.site_city is distinct from old.site_city or new.site_district is distinct from old.site_district or new.site_own is distinct from old.site_own) then
    raise exception 'the contract''s place comes from its survey' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists contracts_guard_site_place on public.contracts;
create trigger contracts_guard_site_place before update of site_city, site_district, site_own on public.contracts
  for each row execute function private.guard_contract_site_place();

create or replace function private.survey_site_to_contracts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.contracts c
     set site_own = new.latitude is not null,
         site_city = case when new.latitude is not null then new.site_city end,
         site_district = case when new.latitude is not null then new.site_district end
    from public.quotes q
   where q.id = c.quote_id and q.survey_id = new.id and c.status in ('draft', 'sent')
     and (c.site_own is distinct from (new.latitude is not null)
          or c.site_city is distinct from (case when new.latitude is not null then new.site_city end)
          or c.site_district is distinct from (case when new.latitude is not null then new.site_district end));
  return null;
end;
$$;
drop trigger if exists surveys_site_to_contracts on public.surveys;
create trigger surveys_site_to_contracts after update of latitude, longitude, site_city, site_district on public.surveys
  for each row execute function private.survey_site_to_contracts();

-- (b) acceptance copies the survey's pin to the project (unless it already has its own)
create or replace function private.contract_site_on_accept()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    insert into public.project_sites (organization_id, contract_id, latitude, longitude, from_survey, survey_latitude, survey_longitude)
    select new.organization_id, new.id, sv.latitude, sv.longitude, true, sv.latitude, sv.longitude
      from public.quotes q
      join public.surveys sv on sv.id = q.survey_id
     where q.id = new.quote_id and sv.latitude is not null
    on conflict (contract_id) do nothing;
  end if;
  return null;
end;
$$;
drop trigger if exists contracts_site_on_accept on public.contracts;
create trigger contracts_site_on_accept after update of status on public.contracts
  for each row execute function private.contract_site_on_accept();

-- (c) the sites list with the source and the place; a pin copied from the survey reads «from the survey»;
--     the survey's live pin counts only until acceptance; the place = the contract's (its survey's own
--     site, `site_own`) else the client's address
drop function if exists public.project_site_list(uuid);
create function public.project_site_list(p_org uuid)
returns table (contract_id uuid, latitude numeric, longitude numeric, own boolean, source text, city text, district text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id,
         coalesce(ps.latitude, case when c.status in ('draft', 'sent') then sv.latitude end, cl.latitude),
         coalesce(ps.longitude, case when c.status in ('draft', 'sent') then sv.longitude end, cl.longitude),
         ps.contract_id is not null and not ps.from_survey,
         case when ps.contract_id is not null and not ps.from_survey then 'project'
              when ps.contract_id is not null or (c.status in ('draft', 'sent') and sv.latitude is not null) then 'survey'
              when cl.latitude is not null then 'client' end,
         case when c.site_own then c.site_city else cl.city end,
         case when c.site_own then c.site_district else cl.district end
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

-- «ارجع للموقع الأساسي» on the project page: back to the pin copied at acceptance (never the survey's
-- current one), else no project pin (→ the survey's until accepted, else the client's)
create or replace function public.reset_project_site(p_contract uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select c.organization_id into v_org from public.contracts c where c.id = p_contract;
  if v_org is null or not private.has_permission(v_org, 'projects.manage') or not private.can_access_contract(v_org, p_contract) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.project_sites
     set latitude = survey_latitude, longitude = survey_longitude, from_survey = true
   where contract_id = p_contract and survey_latitude is not null;
  if not found then
    delete from public.project_sites where contract_id = p_contract;
  end if;
end;
$$;
revoke all on function public.reset_project_site(uuid) from public, anon;
grant execute on function public.reset_project_site(uuid) to authenticated;

-- the client page: the project's place next to the client's address (latest bodies from 20270109000001)
create or replace function private.portal_quote_payload(p_link public.client_portal_links)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'stage', 'quote',
    'org', jsonb_build_object('name', o.name, 'legal_name', o.legal_name, 'cr_number', o.cr_number, 'vat_number', o.vat_number,
                              'phone', o.phone, 'city', o.city, 'address', o.address, 'logo_path', o.logo_path, 'brand', o.brand,
                              'signatory_name', o.signatory_name, 'signatory_title', o.signatory_title),
    'client', jsonb_build_object('name', cl.name, 'phone', cl.phone, 'city', cl.city, 'district', cl.district, 'id_number', cl.id_number,
                                 'site_own', exists (select 1 from private.quote_site_place(q.id)),
                                 'site_city', (select x.city from private.quote_site_place(q.id) x), 'site_district', (select x.district from private.quote_site_place(q.id) x)),
    'quote', jsonb_build_object(
      'number', q.number, 'status', q.status, 'service', q.service,
      -- nothing of an unissued version (draft / waiting for approval) reaches the client
      'version', case when q.status in ('issued', 'accepted', 'rejected') then q.current_version end,
      'date', case when q.status in ('issued', 'accepted', 'rejected') then v.created_at end,
      'valid_until', q.valid_until,
      'total', case when q.status in ('issued', 'accepted', 'rejected') then v.total end,
      'warranty_months', coalesce((select s.default_warranty_months from public.pricing_settings s where s.organization_id = q.organization_id), 6),
      'client_view', case when q.status in ('issued', 'accepted', 'rejected') then v.client_view end,
      'notes', case when q.status in ('issued', 'accepted', 'rejected') then v.notes end,
      'decision', q.client_decision, 'decided_at', q.client_decided_at, 'decided_name', q.client_name,
      'decision_note', q.client_note, 'chosen_version', q.client_version),
    'options', case when q.options is not null and q.status in ('issued', 'accepted', 'rejected') then coalesce((
      select jsonb_agg(jsonb_build_object('version', x.version, 'label', e.e ->> 'label', 'subtotal', x.subtotal, 'vat', x.vat,
                                          'total', x.total, 'date', x.created_at, 'notes', x.notes, 'client_view', x.client_view) order by e.ord)
      from jsonb_array_elements(q.options) with ordinality as e(e, ord)
      join public.quote_versions x on x.quote_id = q.id and x.version = (e.e ->> 'version')::int), '[]'::jsonb) else '[]'::jsonb end,
    'contract', (select jsonb_build_object('number', c.number, 'status', c.status) from public.contracts c where c.id = p_link.contract_id),
    'expires_at', p_link.expires_at)
  from public.quotes q
  join public.organizations o on o.id = q.organization_id
  join public.clients cl on cl.id = q.client_id
  left join public.quote_versions v on v.quote_id = q.id and v.version = q.current_version
  where q.id = p_link.quote_id
$$;
revoke all on function private.portal_quote_payload(public.client_portal_links) from public, anon, authenticated;

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
  if not private.portal_token_ok(p_token) or p_number is null or char_length(p_number) > 30 then
    return null;
  end if;
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null then
    return null;
  end if;
  update public.client_portal_links set last_opened_at = now(), open_count = open_count + 1 where id = v_link.id;

  if v_link.contract_id is null
     or (v_link.quote_id is not null and exists (select 1 from public.contracts c where c.id = v_link.contract_id and c.status = 'draft')) then
    return private.portal_quote_payload(v_link);
  end if;

  select jsonb_build_object(
    'stage', 'contract',
    'org', jsonb_build_object('name', o.name, 'legal_name', o.legal_name, 'cr_number', o.cr_number, 'vat_number', o.vat_number,
                              'phone', o.phone, 'city', o.city, 'address', o.address, 'logo_path', o.logo_path, 'brand', o.brand,
                              'signatory_name', o.signatory_name, 'signatory_title', o.signatory_title),
    'client', jsonb_build_object('name', cl.name, 'phone', cl.phone, 'city', cl.city, 'district', cl.district, 'id_number', cl.id_number,
                                 'site_own', c.site_own, 'site_city', c.site_city, 'site_district', c.site_district),
    'contract', jsonb_build_object('number', c.number, 'status', c.status, 'service', c.service, 'project_type', c.project_type,
                                   'start_date', c.start_date, 'duration_days', c.duration_days, 'warranty_months', c.warranty_months,
                                   'total', c.total, 'notes', c.notes, 'accepted_at', c.accepted_at, 'accepted_name', c.accepted_name, 'created_at', c.created_at),
    'quote', jsonb_build_object('number', q.number, 'version', v.version, 'date', v.created_at, 'valid_until', q.valid_until,
                                'client_view', v.client_view, 'notes', v.notes,
                                'client_accepted_at', case when q.client_decision = 'accepted' then q.client_decided_at end),
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
revoke all on function public.portal_view(text, text) from public, anon, authenticated;
grant execute on function public.portal_view(text, text) to service_role;

-- backfill: contracts made before (from a survey with its own site), and accepted projects
update public.contracts c set site_own = true, site_city = x.city, site_district = x.district
  from public.quotes q, lateral private.quote_site_place(q.id) x
 where q.id = c.quote_id and not c.site_own;
insert into public.project_sites (organization_id, contract_id, latitude, longitude, from_survey, survey_latitude, survey_longitude)
select c.organization_id, c.id, sv.latitude, sv.longitude, true, sv.latitude, sv.longitude
  from public.contracts c join public.quotes q on q.id = c.quote_id join public.surveys sv on sv.id = q.survey_id
 where c.status = 'accepted' and sv.latitude is not null
on conflict (contract_id) do nothing;
