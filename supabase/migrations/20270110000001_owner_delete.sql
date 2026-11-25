-- =============================================================================
-- Deleting clients, surveys and quotes — the owner only (owner, Nov 2026)
-- =============================================================================
-- Before: anyone with clients.manage (e.g. a supervisor) could delete clients and surveys through
-- the API; quotes couldn't be deleted at all. Now:
--   * direct DELETE on clients / surveys / quotes / quote versions is gone for signed-in users
--     (survey rooms stay with clients.manage — part of everyday survey editing);
--   * public.delete_client / delete_survey / delete_quote (definer) check that the caller is the
--     active owner of the row's organization, then apply the rules below;
--   * financial and legal records are never deleted:
--       - a quote with ANY contract (draft, sent, accepted or cancelled) stays — a contract is the
--         legal record and points at its quote (on delete restrict); a cancelled contract keeps
--         its history too;
--       - a quote the client accepted on his page stays (his signed answer, IP and time);
--       - a survey with a quote built on it stays — the quote is priced from its rooms
--         (delete the quote first);
--       - a client with any contract stays; otherwise all his quotes are deleted (same rules —
--         one that can't be deleted keeps the client) and his surveys with their rooms.
--   * deleting a quote removes its versions + costs (cascade), its approvals and their
--     notifications, notifications that link to it, and its client-page links (the token stops
--     working at once).
--   * every deleted row is written to the audit log by the tables' audit triggers, under the
--     owner (auth.uid() inside a definer function is still the caller), with the old row.
-- Rows are locked FOR UPDATE before the checks, so a contract / client answer / new quote made at
-- the same moment either waits and is refused (the row is gone) or is seen by the checks.

drop policy if exists clients_delete on public.clients;
drop policy if exists surveys_delete on public.surveys;
revoke delete on public.clients, public.surveys, public.quotes, public.quote_versions, public.quote_version_costs from authenticated;

-- Internal: delete one quote after the checks (caller already verified as the owner).
create or replace function private.purge_quote(p_quote uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_approvals uuid[];
begin
  select q.id, q.organization_id, q.number, q.client_decision into v
  from public.quotes q where q.id = p_quote for update;
  if v.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.contracts c where c.quote_id = p_quote) then
    raise exception 'quote has a contract' using errcode = 'P0001';
  end if;
  if v.client_decision = 'accepted' then
    raise exception 'quote accepted by the client' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(a.id), '{}') into v_approvals
  from public.approvals a where a.entity = 'quote' and a.entity_id = p_quote;

  delete from public.notifications n
  where n.organization_id = v.organization_id
    and (n.link = '/quotations/' || v.number or (n.params ->> 'approval_id') = any (select x::text from unnest(v_approvals) x));
  delete from public.approvals a where a.id = any (v_approvals);
  delete from public.client_portal_links l where l.quote_id = p_quote;
  -- versions and their costs go with it (on delete cascade)
  delete from public.quotes q where q.id = p_quote;
end;
$$;
revoke all on function private.purge_quote(uuid) from public, anon, authenticated;

create or replace function public.delete_quote(p_quote uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select q.organization_id into v_org from public.quotes q where q.id = p_quote;
  if v_org is null or not private.is_owner(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform private.purge_quote(p_quote);
end;
$$;
revoke all on function public.delete_quote(uuid) from public, anon;
grant execute on function public.delete_quote(uuid) to authenticated, service_role;

create or replace function public.delete_survey(p_survey uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select s.organization_id into v_org from public.surveys s where s.id = p_survey for update;
  if v_org is null or not private.is_owner(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.quotes q where q.survey_id = p_survey) then
    raise exception 'survey has quotes' using errcode = 'P0001';
  end if;
  -- rooms go with it (on delete cascade)
  delete from public.surveys s where s.id = p_survey;
end;
$$;
revoke all on function public.delete_survey(uuid) from public, anon;
grant execute on function public.delete_survey(uuid) to authenticated, service_role;

create or replace function public.delete_client(p_client uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_quote uuid;
begin
  select c.id, c.organization_id, c.number into v from public.clients c where c.id = p_client for update;
  if v.id is null or not private.is_owner(v.organization_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.contracts k where k.client_id = p_client) then
    raise exception 'client has contracts' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.quotes q where q.client_id = p_client and q.client_decision = 'accepted') then
    raise exception 'client has an accepted quote' using errcode = 'P0001';
  end if;
  for v_quote in select q.id from public.quotes q where q.client_id = p_client order by q.created_at loop
    perform private.purge_quote(v_quote);
  end loop;
  delete from public.notifications n where n.organization_id = v.organization_id and n.link = '/clients/' || v.number;
  -- surveys and their rooms go with him (on delete cascade)
  delete from public.clients c where c.id = p_client;
end;
$$;
revoke all on function public.delete_client(uuid) from public, anon;
grant execute on function public.delete_client(uuid) to authenticated, service_role;
