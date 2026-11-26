-- Owner (Nov 2026): «خله يتجمد أول ما ينرسل» — a contract's project place (text) and pin are frozen
-- once it is SENT to the client (before: at acceptance). The survey's live site counts only while the
-- contract is a draft; sending copies the survey's pin to the project (project_sites.from_survey);
-- a contract taken back to draft follows its survey again. Non-destructive.

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

-- sending (or accepting) copies the survey's pin to the project; back to draft forgets that copy
create or replace function private.contract_site_on_accept()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if new.status in ('sent', 'accepted') and (tg_op = 'INSERT' or old.status = 'draft') then
    insert into public.project_sites (organization_id, contract_id, latitude, longitude, from_survey, survey_latitude, survey_longitude)
    select new.organization_id, new.id, sv.latitude, sv.longitude, true, sv.latitude, sv.longitude
      from public.quotes q
      join public.surveys sv on sv.id = q.survey_id
     where q.id = new.quote_id and sv.latitude is not null
    on conflict (contract_id) do nothing;
  elsif tg_op = 'UPDATE' and new.status = 'draft' and old.status = 'sent' then
    delete from public.project_sites where contract_id = new.id and from_survey;
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
         ps.contract_id is not null and not ps.from_survey,
         case when ps.contract_id is not null and not ps.from_survey then 'project'
              when ps.contract_id is not null or (c.status = 'draft' and sv.latitude is not null) then 'survey'
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

-- contracts already sent: keep the pin they were sent with
insert into public.project_sites (organization_id, contract_id, latitude, longitude, from_survey, survey_latitude, survey_longitude)
select c.organization_id, c.id, sv.latitude, sv.longitude, true, sv.latitude, sv.longitude
  from public.contracts c join public.quotes q on q.id = c.quote_id join public.surveys sv on sv.id = q.survey_id
 where c.status = 'sent' and sv.latitude is not null
on conflict (contract_id) do nothing;
