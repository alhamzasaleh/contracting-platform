-- Owner (Nov 2026): «خله يتجمد أول ما ينرسل» — a contract's project place (text) and pin are frozen
-- once it is SENT to the client (before: at acceptance). The live sites count only while the contract
-- is a draft; sending copies the pin (the survey's own site, else the client's) to project_sites
-- (snapshot_from) and the place text (else the client's address) to contracts.site_* (site_own =
-- «the contract carries its own place»); a contract taken back to draft follows its survey again.
-- Users write a project pin only for an accepted contract and never the copied flags. Non-destructive.
alter table public.project_sites
  add column if not exists from_client boolean not null default false,
  add column if not exists snapshot_from text check (snapshot_from in ('survey', 'client'));
update public.project_sites set snapshot_from = 'survey' where survey_latitude is not null and snapshot_from is null;
comment on column public.project_sites.survey_latitude is 'the pin copied when the contract was sent (snapshot_from: survey or client); kept for «back to the main site»';

-- users: a project pin only for an accepted contract; the copied flags / snapshot are the database's
create or replace function private.guard_project_site()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_contract uuid := coalesce(new.contract_id, old.contract_id);
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if not exists (select 1 from public.contracts c where c.id = v_contract and c.status = 'accepted') then
    raise exception 'a project site can be changed only once the contract is accepted' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and (new.from_survey or new.from_client
      or (tg_op = 'INSERT' and (new.survey_latitude is not null or new.survey_longitude is not null or new.snapshot_from is not null))
      or (tg_op = 'UPDATE' and (new.survey_latitude is distinct from old.survey_latitude or new.survey_longitude is distinct from old.survey_longitude
                                or new.snapshot_from is distinct from old.snapshot_from))) then
    raise exception 'copied pins are set by the database' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists project_sites_guard on public.project_sites;
create trigger project_sites_guard before insert or update or delete on public.project_sites
  for each row execute function private.guard_project_site();

-- a sent / accepted contract's place doesn't follow a quote change either
create or replace function private.contract_site_place()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if tg_op = 'UPDATE' and new.status <> 'draft' then
    return new;
  end if;
  select * into r from private.quote_site_place(new.quote_id);
  new.site_own := found;
  new.site_city := r.city;
  new.site_district := r.district;
  return new;
end;
$$;

-- the draft follows its survey; sent / accepted keep what was sent
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
   where q.id = c.quote_id and q.survey_id = new.id and c.status = 'draft'
     and (c.site_own is distinct from (new.latitude is not null)
          or c.site_city is distinct from (case when new.latitude is not null then new.site_city end)
          or c.site_district is distinct from (case when new.latitude is not null then new.site_district end));
  return null;
end;
$$;

-- sending (or inserting as sent / accepting) freezes the pin and the place; back to draft forgets them
create or replace function private.contract_site_on_accept()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  -- entering sent / accepted from any other state (draft, or a cancelled one reopened) freezes them
  if new.status in ('sent', 'accepted') and (tg_op = 'INSERT' or old.status not in ('sent', 'accepted')) then
    -- the pin: the survey's own site, else the client's
    insert into public.project_sites (organization_id, contract_id, latitude, longitude, from_survey, from_client, survey_latitude, survey_longitude, snapshot_from)
    select new.organization_id, new.id, x.lat, x.lng, x.src = 'survey', x.src = 'client', x.lat, x.lng, x.src
      from (
        select coalesce(sv.latitude, cl.latitude) as lat, coalesce(sv.longitude, cl.longitude) as lng,
               case when sv.latitude is not null then 'survey' else 'client' end as src
          from public.clients cl
          left join public.quotes q on q.id = new.quote_id
          left join public.surveys sv on sv.id = q.survey_id
         where cl.id = new.client_id
      ) x
     where x.lat is not null
    on conflict (contract_id) do nothing;
    -- the place text: the client's address when the survey has no site of its own
    if not new.site_own then
      update public.contracts c set site_own = true, site_city = cl.city, site_district = cl.district
        from public.clients cl where cl.id = new.client_id and c.id = new.id;
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'draft' and old.status <> 'draft' then
    delete from public.project_sites where contract_id = new.id and (from_survey or from_client);
    select * into r from private.quote_site_place(new.quote_id);
    update public.contracts set site_own = found, site_city = r.city, site_district = r.district where id = new.id;
  end if;
  return null;
end;
$$;
drop trigger if exists contracts_site_on_accept on public.contracts;
create trigger contracts_site_on_accept after insert or update of status on public.contracts
  for each row execute function private.contract_site_on_accept();

-- the survey's live pin only for a draft
create or replace function private.contract_site(p_contract uuid)
returns table (lat numeric, lng numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(ps.latitude, case when c.status = 'draft' then sv.latitude end, cl.latitude),
         coalesce(ps.longitude, case when c.status = 'draft' then sv.longitude end, cl.longitude)
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

create or replace function public.project_site_list(p_org uuid)
returns table (contract_id uuid, latitude numeric, longitude numeric, own boolean, source text, city text, district text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id,
         coalesce(ps.latitude, case when c.status = 'draft' then sv.latitude end, cl.latitude),
         coalesce(ps.longitude, case when c.status = 'draft' then sv.longitude end, cl.longitude),
         ps.contract_id is not null and not ps.from_survey and not ps.from_client,
         case when ps.contract_id is not null and not ps.from_survey and not ps.from_client then 'project'
              when ps.from_survey or (ps.contract_id is null and c.status = 'draft' and sv.latitude is not null) then 'survey'
              when ps.from_client or cl.latitude is not null then 'client' end,
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

-- contracts already sent: keep the pin they were sent with
insert into public.project_sites (organization_id, contract_id, latitude, longitude, from_survey, survey_latitude, survey_longitude)
select c.organization_id, c.id, sv.latitude, sv.longitude, true, sv.latitude, sv.longitude
  from public.contracts c join public.quotes q on q.id = c.quote_id join public.surveys sv on sv.id = q.survey_id
 where c.status = 'sent' and sv.latitude is not null
on conflict (contract_id) do nothing;

-- «ارجع للموقع الأساسي»: back to the pin frozen when the contract was sent (survey's or client's)
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
     set latitude = survey_latitude, longitude = survey_longitude,
         from_survey = coalesce(snapshot_from, 'survey') = 'survey', from_client = coalesce(snapshot_from, 'survey') = 'client'
   where contract_id = p_contract and survey_latitude is not null;
  if not found then
    delete from public.project_sites where contract_id = p_contract;
  end if;
end;
$$;
revoke all on function public.reset_project_site(uuid) from public, anon;
grant execute on function public.reset_project_site(uuid) to authenticated;

-- sent / accepted contracts made before: freeze the client's pin and address too
insert into public.project_sites (organization_id, contract_id, latitude, longitude, from_client, survey_latitude, survey_longitude, snapshot_from)
select c.organization_id, c.id, cl.latitude, cl.longitude, true, cl.latitude, cl.longitude, 'client'
  from public.contracts c join public.clients cl on cl.id = c.client_id
 where c.status in ('sent', 'accepted') and cl.latitude is not null
on conflict (contract_id) do nothing;
update public.contracts c set site_own = true, site_city = cl.city, site_district = cl.district
  from public.clients cl
 where cl.id = c.client_id and c.status in ('sent', 'accepted') and not c.site_own;

-- the survey page's note «the contract was sent / the project keeps its site»: the number and status of
-- contracts made from this survey (sent / accepted) — for clients.view, without quotes.view
create or replace function public.survey_contracts(p_survey uuid)
returns table (number text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.number, c.status::text
    from public.surveys sv
    join public.quotes q on q.survey_id = sv.id
    join public.contracts c on c.quote_id = q.id
   where sv.id = p_survey
     and c.status in ('sent', 'accepted')
     and private.has_permission(sv.organization_id, 'clients.view')
     and private.can_access_contract(sv.organization_id, c.id)
   order by c.created_at desc;
$$;
revoke all on function public.survey_contracts(uuid) from public, anon;
grant execute on function public.survey_contracts(uuid) to authenticated;
