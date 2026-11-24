-- Shorter client-page links (owner, Nov 2026). New tokens are 12 random bytes = 16 base64url
-- characters (96 bits, with the existing per-IP rate limits); only their SHA-256 is stored, as
-- before. Older 43-character links stay valid. The minimum length lives in one helper; the
-- three portal functions that checked `char_length(p_token) < 32` are redefined with their
-- latest bodies unchanged except for that check (the other portal functions never checked the
-- length: they look the hash up through private.portal_link). CREATE OR REPLACE keeps grants.

create or replace function private.portal_token_ok(p_token text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_token is not null and char_length(p_token) between 16 and 100
$$;
revoke all on function private.portal_token_ok(text) from public;

CREATE OR REPLACE FUNCTION public.portal_view(p_number text, p_token text)
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

  select jsonb_build_object(
    'org', jsonb_build_object('name', o.name, 'legal_name', o.legal_name, 'cr_number', o.cr_number, 'vat_number', o.vat_number,
                              'phone', o.phone, 'city', o.city, 'address', o.address, 'logo_path', o.logo_path, 'brand', o.brand,
                              'signatory_name', o.signatory_name, 'signatory_title', o.signatory_title),
    'client', jsonb_build_object('name', cl.name, 'phone', cl.phone, 'city', cl.city, 'district', cl.district, 'id_number', cl.id_number),
    'contract', jsonb_build_object('number', c.number, 'status', c.status, 'service', c.service, 'project_type', c.project_type,
                                   'start_date', c.start_date, 'duration_days', c.duration_days, 'warranty_months', c.warranty_months,
                                   'total', c.total, 'notes', c.notes, 'accepted_at', c.accepted_at, 'accepted_name', c.accepted_name, 'created_at', c.created_at),
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
$function$

;

CREATE OR REPLACE FUNCTION public.portal_execution(p_number text, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_link public.client_portal_links;
begin
  if not private.portal_token_ok(p_token) or p_number is null or char_length(p_number) > 30 then
    return null;
  end if;
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'seq', s.seq, 'name', s.name, 'status', s.status, 'progress', s.progress, 'is_final', s.is_final,
        'report', case when s.status in ('awaiting_client', 'confirmed') then s.report end,
        'sent_at', s.sent_at, 'confirmed_at', s.confirmed_at, 'confirmed_name', s.confirmed_name,
        'photos', coalesce((select jsonb_agg(ph order by ph) from (
            select unnest(u.photos) as ph from public.progress_updates u
            where u.stage_id = s.id and u.visible_to_client order by u.created_at desc limit 4) x), '[]'::jsonb)
      ) order by s.seq)
      from public.project_stages s where s.contract_id = v_link.contract_id), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'photos', n.photos, 'status', n.status, 'reply', n.reply,
                                          'stage_id', n.stage_id, 'created_at', n.created_at) order by n.created_at desc)
      from public.client_notes n where n.contract_id = v_link.contract_id), '[]'::jsonb),
    'org_id', (select organization_id from public.contracts where id = v_link.contract_id),
    'contract_id', v_link.contract_id
  );
end;
$function$

;

CREATE OR REPLACE FUNCTION public.portal_accept(p_number text, p_token text, p_name text, p_signature text, p_ip text, p_user_agent text, p_version integer DEFAULT NULL::integer)
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
$function$

;

