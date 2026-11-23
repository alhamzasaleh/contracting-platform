-- =============================================================================
-- Multi-option quotes (Appendix A.5) — optional; a quote without options works
-- exactly as before.
--   quotes.options: up to 3 of the quote's own versions offered side by side,
--     each with a short label (e.g. «جوتن» / «الجزيرة» / «عسيب»). Every option is
--     a full frozen version (own price, costs and approvals).
--   contracts.options: copied from the quote when the contract is created; the
--     client picks one on the client page while accepting. The contract then
--     points to that version, takes its total and the payment amounts follow
--     the agreed percentages. Frozen after acceptance.
-- =============================================================================

create or replace function private.valid_options(p_options jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_options is null or (
    jsonb_typeof(p_options) = 'array'
    and jsonb_array_length(p_options) between 2 and 3
    and not exists (
      select 1 from jsonb_array_elements(p_options) e
      where jsonb_typeof(e) <> 'object'
         or jsonb_typeof(e -> 'version') <> 'number'
         or (e ->> 'version')::numeric <> floor((e ->> 'version')::numeric)
         or (e ->> 'version')::int < 1
         or jsonb_typeof(e -> 'label') <> 'string'
         or char_length(trim(e ->> 'label')) not between 1 and 60
         or (select count(*) from jsonb_object_keys(e)) <> 2)
    and (select count(distinct (e ->> 'version')) from jsonb_array_elements(p_options) e) = jsonb_array_length(p_options)
  )
$$;

alter table public.quotes add column options jsonb check (private.valid_options(options));
alter table public.contracts add column options jsonb check (private.valid_options(options));

-- Options must be versions of the same quote; a contract with options points to one of them.
create or replace function private.check_quote_options()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(new);  -- one function for both tables (fields read by name)
  v_quote uuid := case when tg_table_name = 'quotes' then (v_row ->> 'id')::uuid else (v_row ->> 'quote_id')::uuid end;
begin
  if new.options is null then
    return new;
  end if;
  if exists (
    select 1 from jsonb_array_elements(new.options) e
    where not exists (select 1 from public.quote_versions v where v.quote_id = v_quote and v.version = (e ->> 'version')::int)
  ) then
    raise exception 'option is not a version of this quote' using errcode = '22023';
  end if;
  if tg_table_name = 'contracts' and not exists (
    select 1 from jsonb_array_elements(new.options) e where (e ->> 'version')::int = (v_row ->> 'quote_version')::int
  ) then
    raise exception 'the contract must point to one of its options' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger quotes_options_check before insert or update of options on public.quotes
  for each row execute function private.check_quote_options();
create trigger contracts_options_check before insert or update of options, quote_version on public.contracts
  for each row execute function private.check_quote_options();

-- Options are frozen once the client has accepted (same rule as the rest of the contract).
create or replace function private.guard_contract_options()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and old.status = 'accepted' and new.options is distinct from old.options then
    raise exception 'an accepted contract cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger contracts_options_guard before update of options on public.contracts
  for each row execute function private.guard_contract_options();

-- Client page: the contract's options side by side (version, label, totals, what's included).
create or replace function public.portal_options(p_number text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
begin
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null then
    return null;
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('version', v.version, 'label', e ->> 'label', 'subtotal', v.subtotal, 'vat', v.vat,
                                                 'total', v.total, 'date', v.created_at, 'notes', v.notes, 'client_view', v.client_view)
                              order by o.ord), '[]'::jsonb)
    from public.contracts c
    cross join lateral jsonb_array_elements(c.options) with ordinality as o(e, ord)
    join public.quote_versions v on v.quote_id = c.quote_id and v.version = (o.e ->> 'version')::int
    where c.id = v_link.contract_id and c.options is not null
  );
end;
$$;
revoke all on function public.portal_options(text, text) from public, anon, authenticated;
grant execute on function public.portal_options(text, text) to service_role;

-- Acceptance with the client's choice (p_version required when the contract has options).
drop function public.portal_accept(text, text, text, text, text, text);
create or replace function public.portal_accept(p_number text, p_token text, p_name text, p_signature text, p_ip text, p_user_agent text, p_version int default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
  v_contract public.contracts;
  v_total numeric;
  v_last int;
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 100 then
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
  update public.quotes q set status = 'accepted' where q.id = v_contract.quote_id;
  insert into public.audit_log (organization_id, actor_id, action, table_name, record_id, after)
  values (v_contract.organization_id, null, 'client_accept', 'contracts', v_contract.id::text,
          jsonb_build_object('name', trim(p_name), 'ip', left(p_ip, 64), 'signed', p_signature is not null, 'option', p_version));
  return true;
end;
$$;
revoke all on function public.portal_accept(text, text, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.portal_accept(text, text, text, text, text, text, int) to service_role;
