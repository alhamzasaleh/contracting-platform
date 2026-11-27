-- The client's ID number is asked on his page when it's missing (owner, Nov 2026): the
-- contract names him by it. Accepting the quote, or the contract, needs it once; when the
-- client's record already has one nothing is asked and the given value is ignored (the
-- client page never changes a number staff entered). Stored on clients.id_number (audited by
-- the clients audit trigger + an explicit row). The app also checks the Saudi ID / iqama check
-- digit; the database keeps the column's rule (10 digits).

create or replace function private.portal_take_client_id(p_client uuid, p_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_have text;
begin
  select organization_id, id_number into v_org, v_have from public.clients where id = p_client for update;
  if v_org is null or v_have is not null then
    return;
  end if;
  if p_id is null or p_id !~ '^[0-9]{10}$' then
    raise exception 'id required' using errcode = '22023';
  end if;
  update public.clients set id_number = p_id where id = p_client;
  insert into public.audit_log (organization_id, actor_id, action, table_name, record_id, after)
  values (v_org, null, 'client_id_number', 'clients', p_client::text, jsonb_build_object('id_number', p_id));
end;
$$;
revoke all on function private.portal_take_client_id(uuid, text) from public, anon, authenticated;

drop function if exists public.portal_accept_quote(text, text, text, text, text, int);
create or replace function public.portal_accept_quote(p_number text, p_token text, p_name text, p_ip text, p_user_agent text, p_version int default null, p_id_number text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
begin
  if p_name is null or char_length(trim(p_name)) < 2 or char_length(p_name) > 160 then
    raise exception 'name required' using errcode = '22023';
  end if;
  q := private.portal_open_quote(p_number, p_token);
  if q.id is null then
    return false;
  end if;
  if q.valid_until is not null and q.valid_until < (now() at time zone 'Asia/Riyadh')::date then
    raise exception 'quote expired' using errcode = '22023';
  end if;
  -- the client accepts exactly the version on his screen: with options one of them, else the
  -- current version (a newer one issued meanwhile → he must see it first)
  if q.options is not null then
    if p_version is null or not exists (select 1 from jsonb_array_elements(q.options) e where (e ->> 'version')::int = p_version) then
      raise exception 'choose an option' using errcode = '22023';
    end if;
  elsif p_version is null or p_version <> q.current_version then
    raise exception 'offer changed' using errcode = '22023';
  end if;
  perform private.portal_take_client_id(q.client_id, p_id_number);
  update public.quotes
  set client_decision = 'accepted', client_decided_at = now(), client_name = trim(p_name), client_note = null,
      client_version = p_version, client_ip = left(p_ip, 64), client_user_agent = left(p_user_agent, 400)
  where id = q.id;
  insert into public.audit_log (organization_id, actor_id, action, table_name, record_id, after)
  values (q.organization_id, null, 'client_accept_quote', 'quotes', q.id::text,
          jsonb_build_object('name', trim(p_name), 'ip', left(p_ip, 64), 'version', p_version));
  return true;
end;
$$;
revoke all on function public.portal_accept_quote(text, text, text, text, text, int, text) from public, anon, authenticated;
grant execute on function public.portal_accept_quote(text, text, text, text, text, int, text) to service_role;

drop function if exists public.portal_accept(text, text, text, text, text, text, int);
CREATE OR REPLACE FUNCTION public.portal_accept(p_number text, p_token text, p_name text, p_signature text, p_ip text, p_user_agent text, p_version integer DEFAULT NULL::integer, p_id_number text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_link public.client_portal_links;
  v_contract public.contracts;
  v_total numeric;
  v_last int;
begin
  if not private.portal_token_ok(p_token) then
    return false;
  end if;
  if p_name is null or char_length(trim(p_name)) < 2 or char_length(p_name) > 160 then
    raise exception 'name required' using errcode = '22023';
  end if;
  if p_signature is not null and (char_length(p_signature) > 200000 or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$') then
    raise exception 'invalid signature' using errcode = '22023';
  end if;
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null then
    return false;
  end if;
  select * into v_contract from public.contracts where id = v_link.contract_id and status = 'sent' for update;
  if v_contract.id is null then
    return false;
  end if;
  if not exists (select 1 from public.contract_payments p where p.contract_id = v_contract.id) then
    raise exception 'no payment schedule' using errcode = '22023';
  end if;

  if v_contract.options is not null then
    if p_version is null or not exists (select 1 from jsonb_array_elements(v_contract.options) e where (e ->> 'version')::int = p_version) then
      raise exception 'choose an option' using errcode = '22023';
    end if;
    select v.total into v_total from public.quote_versions v where v.quote_id = v_contract.quote_id and v.version = p_version;
    -- the payment amounts follow the agreed percentages of the chosen option (the last absorbs rounding)
    select max(seq) into v_last from public.contract_payments where contract_id = v_contract.id;
    update public.contract_payments p
    set amount = case when p.seq = v_last
                      then v_total - coalesce((select sum(round(v_total * x.percent / 100, 2)) from public.contract_payments x
                                               where x.contract_id = v_contract.id and x.seq <> v_last), 0)
                      else round(v_total * p.percent / 100, 2) end
    where p.contract_id = v_contract.id;
    update public.contracts set quote_version = p_version, total = v_total where id = v_contract.id;
  elsif p_version is not null and p_version <> v_contract.quote_version then
    raise exception 'no options on this contract' using errcode = '22023';
  end if;

  perform private.portal_take_client_id(v_contract.client_id, p_id_number);

  update public.contracts
  set status = 'accepted', accepted_at = now(), accepted_name = trim(p_name), accepted_signature = p_signature,
      accepted_ip = left(p_ip, 64), accepted_user_agent = left(p_user_agent, 400)
  where id = v_contract.id;
  -- the quote shows what the client agreed to (the chosen option)
  update public.quotes q set status = 'accepted', current_version = coalesce(p_version, v_contract.quote_version) where q.id = v_contract.quote_id;
  insert into public.audit_log (organization_id, actor_id, action, table_name, record_id, after)
  values (v_contract.organization_id, null, 'client_accept', 'contracts', v_contract.id::text,
          jsonb_build_object('name', trim(p_name), 'ip', left(p_ip, 64), 'signed', p_signature is not null, 'option', p_version));
  return true;
end;
$function$;
revoke all on function public.portal_accept(text, text, text, text, text, text, int, text) from public, anon, authenticated;
grant execute on function public.portal_accept(text, text, text, text, text, text, int, text) to service_role;

-- The signed contract keeps the ID number it was signed with (review): staff may correct the
-- client's record later, the accepted contract (its text, print, handover certificate) doesn't
-- change. Set only by the database when the contract becomes accepted; users can't write it.
alter table public.contracts add column if not exists client_id_number text check (client_id_number ~ '^[0-9]{10}$');

create or replace function private.guard_contract_client_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if (tg_op = 'INSERT' and new.client_id_number is not null)
       or (tg_op = 'UPDATE' and new.client_id_number is distinct from old.client_id_number) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists contracts_client_id_guard on public.contracts;
create trigger contracts_client_id_guard before insert or update on public.contracts
  for each row execute function private.guard_contract_client_id();

create or replace function private.contract_client_id_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    select cl.id_number into new.client_id_number from public.clients cl where cl.id = new.client_id;
  end if;
  return new;
end;
$$;
drop trigger if exists contracts_client_id_snapshot on public.contracts;
create trigger contracts_client_id_snapshot before update of status on public.contracts
  for each row execute function private.contract_client_id_snapshot();

-- contracts already accepted keep the number on record today
update public.contracts c set client_id_number = cl.id_number
from public.clients cl
where cl.id = c.client_id and c.status = 'accepted' and c.client_id_number is null and cl.id_number is not null;

-- the contract stage shows the number the contract was signed with
create or replace function public.portal_view(p_number text, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'client', jsonb_build_object('name', cl.name, 'phone', cl.phone, 'city', cl.city, 'district', cl.district, 'id_number', coalesce(c.client_id_number, cl.id_number),
                                 'site_own', c.site_own, 'site_city', c.site_city, 'site_district', c.site_district),
    'contract', jsonb_build_object('number', c.number, 'status', c.status, 'service', c.service, 'project_type', c.project_type,
                                   'start_date', c.start_date, 'duration_days', c.duration_days, 'warranty_months', c.warranty_months,
                                   'total', c.total, 'notes', c.notes, 'accepted_at', c.accepted_at, 'accepted_name', c.accepted_name, 'created_at', c.created_at),
    'quote', jsonb_build_object('number', q.number, 'version', v.version, 'date', v.created_at, 'valid_until', q.valid_until,
                                'client_view', v.client_view, 'notes', v.notes,
                                'client_accepted_at', case when q.client_decision = 'accepted' then q.client_decided_at end),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('seq', p.seq, 'label', p.label, 'percent', p.percent, 'amount', p.amount,
                                                              'due_event', p.due_event, 'status', p.status, 'kind', p.kind, 'adjust', p.measure_adjust) order by p.seq)
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
$function$;
