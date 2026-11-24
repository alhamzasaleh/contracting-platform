-- Quote first, then contract (owner, Nov 2026 — §3.6 / §3.14).
--
-- The client page is ONE link for every stage: it is issued from the quote («إرسال للعميل»,
-- issued quotes only) as /p/<quote number>/<token>; the client accepts the quote (name, and the
-- option when several are offered), asks for changes (a note) or declines (optional reason).
-- When a contract is made from that quote, the same link is attached to the contract
-- automatically, so it keeps working for the contract, the project and the warranty. Links
-- issued on a contract number (/p/C-…/<token>) work as before.
--
-- Non-destructive: new nullable columns, one constraint relaxed (client_portal_links.contract_id
-- may be null while the link belongs to the quote only), functions redefined.

-- 1. The client's answer on the quote ------------------------------------------------------
alter table public.quotes
  add column client_decision text check (client_decision in ('accepted', 'changes_requested', 'rejected')),
  add column client_decided_at timestamptz,
  add column client_version int,
  add column client_name text check (char_length(client_name) <= 160),
  add column client_note text check (char_length(client_note) <= 2000),
  add column client_ip text check (char_length(client_ip) <= 64),
  add column client_user_agent text check (char_length(client_user_agent) <= 400);
alter table public.quotes add constraint quotes_client_decision_shape check (
  (client_decision is null and client_decided_at is null and client_version is null and client_name is null and client_note is null)
  or (client_decision is not null and client_decided_at is not null)
);
alter table public.quotes add constraint quotes_client_accepted_version check (client_decision is distinct from 'accepted' or client_version is not null);

-- guard_quote (latest body from review batch 1) + the client's answer:
--  * what the client accepted stays: no new version / other options (until the contract is accepted)
--  * a new offer (new version, other options, or issued again after a rejection) clears an
--    earlier «changes requested» / «rejected», so the page shows the new offer with its buttons
--  * users never write the client_* columns (only the portal functions, as the service role)
create or replace function private.guard_quote()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cleared boolean := false;
begin
  -- what the client accepted stays: no new version (saving one moves current_version), whoever saves it
  if tg_op = 'UPDATE' and old.status = 'accepted' and new.current_version is distinct from old.current_version then
    raise exception 'an accepted quote can''t change' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.client_decision = 'accepted' and new.status is distinct from 'accepted'
     and (new.current_version is distinct from old.current_version or new.options is distinct from old.options) then
    raise exception 'the client accepted this quote: it can''t change' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and old.client_decision in ('changes_requested', 'rejected')
     and new.client_decision is not distinct from old.client_decision
     and new.client_decided_at is not distinct from old.client_decided_at
     and (new.current_version is distinct from old.current_version or new.options is distinct from old.options
          or (new.status = 'issued' and old.status is distinct from 'issued')
          -- a renewed validity is a renewed offer: the change request has been answered
          or (old.client_decision = 'changes_requested' and new.valid_until is distinct from old.valid_until)) then
    new.client_decision := null;
    new.client_decided_at := null;
    new.client_version := null;
    new.client_name := null;
    new.client_note := null;
    new.client_ip := null;
    new.client_user_agent := null;
    -- a declined quote revised with a new version is a draft again (to be issued)
    if new.status = 'rejected' and old.client_decision = 'rejected' then
      new.status := 'draft';
    end if;
    v_cleared := true;
  end if;
  -- the offer changed (new version or other options): it must be issued again
  if tg_op = 'UPDATE' and old.status = 'issued' and new.status = 'issued'
     and (new.current_version is distinct from old.current_version or new.options is distinct from old.options) then
    new.status := 'draft';
  end if;
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'pending_approval') then
      raise exception 'quotes are issued through issue_quote' using errcode = '42501';
    end if;
    if new.client_decision is not null or new.client_decided_at is not null or new.client_version is not null or new.client_name is not null
       or new.client_note is not null or new.client_ip is not null or new.client_user_agent is not null then
      raise exception 'only the client answers a quote' using errcode = '42501';
    end if;
    return new;
  end if;
  if not v_cleared and (
       new.client_decision is distinct from old.client_decision or new.client_decided_at is distinct from old.client_decided_at
    or new.client_version is distinct from old.client_version or new.client_name is distinct from old.client_name
    or new.client_note is distinct from old.client_note or new.client_ip is distinct from old.client_ip
    or new.client_user_agent is distinct from old.client_user_agent) then
    raise exception 'only the client answers a quote' using errcode = '42501';
  end if;
  if old.status = 'accepted' and (new.status is distinct from old.status or new.options is distinct from old.options) then
    raise exception 'an accepted quote can''t change' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and new.status in ('issued', 'accepted') then
    raise exception 'quotes are issued through issue_quote' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 2. Links that belong to a quote (then to its contract) --------------------------------------
alter table public.client_portal_links add column quote_id uuid references public.quotes (id) on delete cascade;
alter table public.client_portal_links alter column contract_id drop not null;
alter table public.client_portal_links add constraint client_portal_links_target check (contract_id is not null or quote_id is not null);
create index client_portal_links_quote_idx on public.client_portal_links (quote_id);

-- users: contract links only (as before); quote links come from issue_quote_link; nothing re-pointed
create or replace function private.guard_portal_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.revoked_at is not null or new.expires_at > now() + interval '3 years' then
      raise exception 'invalid link' using errcode = '22023';
    end if;
    if new.quote_id is not null or new.contract_id is null then
      raise exception 'quote links are issued through issue_quote_link' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.token_hash is distinct from old.token_hash or new.contract_id is distinct from old.contract_id
     or new.quote_id is distinct from old.quote_id
     or new.organization_id is distinct from old.organization_id or new.expires_at is distinct from old.expires_at
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'links can only be revoked' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- the quote stage: valid until the quote's validity + 30 days (end of that day, Riyadh); a quote
-- without a validity date counts the usual 7 days from today; never before today + 30 days
create or replace function private.quote_link_expiry(p_valid_until date)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((greatest(coalesce(p_valid_until, (now() at time zone 'Asia/Riyadh')::date + 7), (now() at time zone 'Asia/Riyadh')::date) + 31)::timestamp)
         at time zone 'Asia/Riyadh'
$$;
revoke all on function private.quote_link_expiry(date) from public, anon, authenticated;

-- a contract that isn't handed over: start + duration + accepted addenda days + 30 days + warranty
create or replace function private.portal_planned_expiry(p_contract uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select ((c.start_date + c.duration_days
           + coalesce((select sum(a.extra_days) from public.addenda a where a.contract_id = c.id and a.status = 'accepted'), 0)::int
           + 30 + make_interval(months => c.warranty_months))::date)::timestamp at time zone 'Asia/Riyadh'
  from public.contracts c where c.id = p_contract
$$;
revoke all on function private.portal_planned_expiry(uuid) from public, anon, authenticated;

-- portal_link_floor (batch 2) + the quote stage
create or replace function private.portal_link_floor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.contracts;
  v_end date;
  v_valid date;
begin
  if new.contract_id is null then
    if new.quote_id is not null then
      select q.valid_until into v_valid from public.quotes q where q.id = new.quote_id;
      new.expires_at := greatest(new.expires_at, private.quote_link_expiry(v_valid));
    end if;
    return new;
  end if;
  select * into c from public.contracts where id = new.contract_id;
  if c.id is null then
    return new;
  end if;
  v_end := private.warranty_end(c.id);
  if v_end is not null then
    if v_end < (now() at time zone 'Asia/Riyadh')::date then
      raise exception 'warranty_ended' using errcode = 'P0001', hint = 'the warranty has ended: the client page is closed';
    end if;
    new.expires_at := (v_end + 1)::timestamp at time zone 'Asia/Riyadh';
    return new;
  end if;
  new.expires_at := greatest(new.expires_at, private.portal_planned_expiry(c.id));
  return new;
end;
$$;

-- the token decides the link; the number in the address is the contract's or (for a link
-- issued from the quote) the quote's
create or replace function private.portal_link(p_number text, p_token text)
returns public.client_portal_links
language sql
stable
security definer
set search_path = ''
as $$
  select l.*
  from public.client_portal_links l
  left join public.contracts c on c.id = l.contract_id
  left join public.quotes q on q.id = l.quote_id
  where l.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and l.revoked_at is null
    and l.expires_at > now()
    and (c.id is null or c.status <> 'cancelled')
    and ((c.id is not null and c.number = p_number) or (q.id is not null and q.number = p_number))
  limit 1
$$;
revoke all on function private.portal_link(text, text) from public, anon, authenticated;

-- «إرسال للعميل» on the quote: issued quotes only, no contract yet (then the contract page sends
-- it); the new link replaces the quote's earlier ones; expiry set here (validity + 30 days)
create or replace function public.issue_quote_link(p_quote uuid, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v_id uuid;
begin
  select * into q from public.quotes where id = p_quote for update;
  if q.id is null or not private.has_permission(q.organization_id, 'quotes.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid link' using errcode = '22023';
  end if;
  if q.status <> 'issued' then
    raise exception 'quote not issued' using errcode = '22023';
  end if;
  if exists (select 1 from public.contracts c where c.quote_id = q.id and c.status <> 'cancelled') then
    raise exception 'a contract exists: send it from the contract' using errcode = '22023';
  end if;
  insert into public.client_portal_links (organization_id, quote_id, token_hash, expires_at)
  values (q.organization_id, q.id, p_token_hash, private.quote_link_expiry(q.valid_until))
  returning id into v_id;
  update public.client_portal_links set revoked_at = now()
  where quote_id = q.id and revoked_at is null and id <> v_id;
  return v_id;
end;
$$;
revoke all on function public.issue_quote_link(uuid, text) from public, anon;
grant execute on function public.issue_quote_link(uuid, text) to authenticated;

-- a new validity date keeps the quote's open link alive accordingly (never shortens it)
create or replace function private.quote_link_follow_validity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.valid_until is distinct from old.valid_until then
    update public.client_portal_links l
    set expires_at = greatest(l.expires_at, private.quote_link_expiry(new.valid_until))
    where l.quote_id = new.id and l.contract_id is null and l.revoked_at is null and l.expires_at > now();
  end if;
  return null;
end;
$$;
create trigger quotes_link_validity after update of valid_until on public.quotes
  for each row execute function private.quote_link_follow_validity();

-- a contract made from the quote takes over the quote's open link (same address, same token);
-- the contract floor then applies, and follows later date edits until the handover
create or replace function private.contract_portal_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.client_portal_links l set contract_id = new.id
    where l.quote_id = new.quote_id and l.contract_id is null and l.revoked_at is null and l.expires_at > now()
      and l.organization_id = new.organization_id;
  end if;
  if new.status <> 'cancelled' and private.warranty_end(new.id) is null then
    update public.client_portal_links l
    set expires_at = greatest(l.expires_at, private.portal_planned_expiry(new.id))
    where l.contract_id = new.id and l.revoked_at is null and l.expires_at > now();
  end if;
  return null;
end;
$$;
create trigger contracts_portal_link after insert or update of start_date, duration_days, warranty_months on public.contracts
  for each row execute function private.contract_portal_link();

-- 3. Contracts from a quote the client accepted: his option, no second choice -----------------
create or replace function public.create_contract(p_quote uuid, p_start date, p_duration int, p_warranty int, p_notes text, p_payments jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  q public.quotes;
  v_version int;
  v_options jsonb;
  v_total numeric;
  v_selection jsonb;
  v_terms jsonb;
  v_id uuid;
  v_number text;
begin
  -- locked against the client answering at the same moment (portal_open_quote locks it too)
  select * into q from public.quotes where id = p_quote for share;
  if q.id is null or q.status <> 'issued' then
    raise exception 'quote not issued' using errcode = '22023';
  end if;
  if q.client_decision = 'accepted' then
    -- the client accepted this version (his chosen option) on his page: the contract is that offer only
    v_version := q.client_version;
    v_options := null;
  else
    -- with options the client picks later; until then the contract shows the first one offered
    v_version := case
      when q.options is not null and jsonb_array_length(q.options) > 0 then
        case when exists (select 1 from jsonb_array_elements(q.options) e where (e ->> 'version')::int = q.current_version)
             then q.current_version else (q.options -> 0 ->> 'version')::int end
      else q.current_version end;
    v_options := q.options;
  end if;
  select v.total, v.selection into v_total, v_selection from public.quote_versions v where v.quote_id = q.id and v.version = v_version;
  if v_total is null then
    raise exception 'quote version not found' using errcode = 'P0002';
  end if;
  select t.terms into v_terms from public.contract_templates t where t.organization_id = q.organization_id;
  insert into public.contracts (organization_id, quote_id, quote_version, options, client_id, service, project_type,
                                start_date, duration_days, warranty_months, total, notes, terms)
  values (q.organization_id, q.id, v_version, v_options, q.client_id, q.service,
          coalesce(v_selection -> 'options' ->> 'projectType', 'full'),
          p_start, p_duration, p_warranty, v_total, nullif(trim(p_notes), ''), coalesce(v_terms, '{}'::jsonb))
  returning id, number into v_id, v_number;
  perform public.save_contract_schedule(v_id, p_start, p_duration, p_warranty, p_notes, p_payments);
  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;
revoke all on function public.create_contract(uuid, date, int, int, text, jsonb) from public, anon;
grant execute on function public.create_contract(uuid, date, int, int, text, jsonb) to authenticated;

-- 4. The client page --------------------------------------------------------------------------
-- quote stage: a link that has no contract yet, or whose contract (made from the quote) is
-- still a draft being prepared. The document is shown only for an offer that was issued.
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
    'client', jsonb_build_object('name', cl.name, 'phone', cl.phone, 'city', cl.city, 'district', cl.district, 'id_number', cl.id_number),
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

-- portal_view (latest body: short portal token) + the stage; contract stage also says when the
-- client accepted the quote on his page
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
    'client', jsonb_build_object('name', cl.name, 'phone', cl.phone, 'city', cl.city, 'district', cl.district, 'id_number', cl.id_number),
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

-- the quote a link may answer: a quote-stage link, the quote issued and no contract made from it
create or replace function private.portal_open_quote(p_number text, p_token text)
returns public.quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
  q public.quotes;
begin
  if not private.portal_token_ok(p_token) or p_number is null or char_length(p_number) > 30 then
    return null;
  end if;
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null or v_link.quote_id is null or v_link.contract_id is not null then
    return null;
  end if;
  select * into q from public.quotes where id = v_link.quote_id for update;
  if exists (select 1 from public.contracts c where c.quote_id = q.id and c.status <> 'cancelled') then
    return null;
  end if;
  if q.status <> 'issued' then
    raise exception 'quote not open' using errcode = '22023';
  end if;
  if q.client_decision in ('accepted', 'rejected') then
    raise exception 'already decided' using errcode = '22023';
  end if;
  return q;
end;
$$;
revoke all on function private.portal_open_quote(text, text) from public, anon, authenticated;

-- the client accepts the quote: his name, time, IP, device and (with options) the option he
-- chose. Prices never change here; the accepted version is kept for the contract.
create or replace function public.portal_accept_quote(p_number text, p_token text, p_name text, p_ip text, p_user_agent text, p_version int default null)
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
revoke all on function public.portal_accept_quote(text, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.portal_accept_quote(text, text, text, text, text, int) to service_role;

-- the client asks for changes (a note); he can still accept or decline the offer afterwards,
-- and a new version / issuing again clears the request
create or replace function public.portal_request_quote_changes(p_number text, p_token text, p_note text, p_ip text, p_user_agent text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
begin
  if p_note is null or char_length(trim(p_note)) < 1 or char_length(trim(p_note)) > 2000 then
    raise exception 'note required' using errcode = '22023';
  end if;
  q := private.portal_open_quote(p_number, p_token);
  if q.id is null then
    return false;
  end if;
  update public.quotes
  set client_decision = 'changes_requested', client_decided_at = now(), client_name = null, client_note = trim(p_note),
      client_version = null, client_ip = left(p_ip, 64), client_user_agent = left(p_user_agent, 400)
  where id = q.id;
  insert into public.audit_log (organization_id, actor_id, action, table_name, record_id, after)
  values (q.organization_id, null, 'client_quote_changes', 'quotes', q.id::text,
          jsonb_build_object('note', trim(p_note), 'ip', left(p_ip, 64), 'version', q.current_version));
  return true;
end;
$$;
revoke all on function public.portal_request_quote_changes(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.portal_request_quote_changes(text, text, text, text, text) to service_role;

-- the client declines (optional reason): the quote is rejected (counted as lost)
create or replace function public.portal_reject_quote(p_number text, p_token text, p_reason text, p_ip text, p_user_agent text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
begin
  if p_reason is not null and char_length(trim(p_reason)) > 2000 then
    raise exception 'reason too long' using errcode = '22023';
  end if;
  q := private.portal_open_quote(p_number, p_token);
  if q.id is null then
    return false;
  end if;
  update public.quotes
  set status = 'rejected', client_decision = 'rejected', client_decided_at = now(), client_name = null,
      client_note = nullif(trim(p_reason), ''), client_version = null, client_ip = left(p_ip, 64), client_user_agent = left(p_user_agent, 400)
  where id = q.id;
  insert into public.audit_log (organization_id, actor_id, action, table_name, record_id, after)
  values (q.organization_id, null, 'client_reject_quote', 'quotes', q.id::text,
          jsonb_build_object('reason', nullif(trim(p_reason), ''), 'ip', left(p_ip, 64), 'version', q.current_version));
  return true;
end;
$$;
revoke all on function public.portal_reject_quote(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.portal_reject_quote(text, text, text, text, text) to service_role;

-- 5. Notifications: the client answered the quote -----------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted', 'payment_received', 'payment_late', 'doc_expiry', 'approval_reminder', 'maintenance_request',
  'project_delay', 'project_over_budget', 'project_losing', 'missed_visit', 'agreement_review',
  'quote_accepted', 'quote_changes_requested', 'quote_rejected'));
alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check check (kind in (
  'approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted', 'payment_received', 'payment_late', 'doc_expiry', 'approval_reminder', 'maintenance_request',
  'project_delay', 'project_over_budget', 'project_losing', 'missed_visit', 'agreement_review',
  'quote_accepted', 'quote_changes_requested', 'quote_rejected'));

create or replace function private.notify_quote_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client text;
begin
  if new.client_decision is not null
     and (new.client_decision is distinct from old.client_decision or new.client_decided_at is distinct from old.client_decided_at) then
    select cl.name into v_client from public.clients cl where cl.id = new.client_id;
    perform private.notify(new.organization_id, 'quotes.view', 'quote_' || new.client_decision,
      jsonb_build_object('number', new.number, 'name', coalesce(new.client_name, v_client), 'note', left(new.client_note, 300)),
      '/quotations/' || new.number,
      'quote_decision:' || new.id || ':' || new.client_decision || ':' || floor(extract(epoch from new.client_decided_at))::bigint);
  end if;
  return null;
end;
$$;
create trigger quotes_notify_decision after update of client_decision, client_decided_at on public.quotes
  for each row execute function private.notify_quote_decision();

-- 6. Review fixes --------------------------------------------------------------------------------
-- issue_quote (latest body: review batch 1) + issuing again answers a change request
CREATE OR REPLACE FUNCTION public.issue_quote(p_quote uuid, p_valid_until date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  q public.quotes;
  v int;
  v_min numeric;
  v_margin numeric;
  v_discount numeric;
  v_decider boolean;
begin
  select * into q from public.quotes where id = p_quote for update;
  if q.id is null or not private.has_permission(q.organization_id, 'quotes.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if q.status = 'accepted' then
    raise exception 'an accepted quote can''t be issued again' using errcode = '22023';
  end if;
  if q.current_version = 0 then
    raise exception 'nothing to issue' using errcode = '22023';
  end if;
  if p_valid_until is not null and (p_valid_until < current_date or p_valid_until > current_date + 366) then
    raise exception 'invalid validity date' using errcode = '22023';
  end if;
  select s.min_margin_percent into v_min from public.pricing_settings s where s.organization_id = q.organization_id;
  v_min := coalesce(v_min, 20);
  v_decider := private.has_permission(q.organization_id, 'approvals.decide');
  foreach v in array private.offered_versions(q.id) loop
    if not exists (select 1 from public.quote_versions x where x.quote_id = q.id and x.version = v) then
      raise exception 'option is not a version of this quote' using errcode = '22023';
    end if;
    if exists (select 1 from public.quote_versions x where x.quote_id = q.id and x.version = v and x.problems > 0) then
      raise exception 'unpriced items' using errcode = '22023';
    end if;
    if exists (select 1 from public.approvals a where a.entity = 'quote' and a.entity_id = q.id
               and a.status in ('pending', 'rejected') and a.details ->> 'version' = v::text) then
      raise exception 'waiting for the owner''s approval' using errcode = '22023';
    end if;
    -- the owner approves by issuing; anyone else needs an approved request
    if not v_decider then
      select c.margin_percent, x.discount into v_margin, v_discount
      from public.quote_versions x left join public.quote_version_costs c on c.quote_version_id = x.id
      where x.quote_id = q.id and x.version = v;
      if (v_margin is null or v_margin < v_min) and not exists (
        select 1 from public.approvals a where a.entity = 'quote' and a.entity_id = q.id and a.kind = 'quote_margin'
          and a.status = 'approved' and a.details ->> 'version' = v::text) then
        raise exception 'the margin needs the owner''s approval' using errcode = '22023';
      end if;
      if coalesce(v_discount, 0) > 0 and not exists (
        select 1 from public.approvals a where a.entity = 'quote' and a.entity_id = q.id and a.kind = 'quote_discount'
          and a.status = 'approved' and a.details ->> 'version' = v::text) then
        raise exception 'the discount needs the owner''s approval' using errcode = '22023';
      end if;
    end if;
  end loop;
  update public.quotes set status = 'issued', valid_until = coalesce(p_valid_until, valid_until) where id = q.id;
  -- issued again = the client's change request has been answered: his page shows the offer with its buttons
  update public.quotes
  set client_decision = null, client_decided_at = null, client_version = null, client_name = null,
      client_note = null, client_ip = null, client_user_agent = null
  where id = q.id and client_decision = 'changes_requested';
end;
$function$;
revoke all on function public.issue_quote(uuid, date) from public, anon;
grant execute on function public.issue_quote(uuid, date) to authenticated;

-- a contract from a quote the client accepted on his page stays on his version, with no options
-- (draft / sent; whoever writes it)
create or replace function private.check_contract_client_choice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
begin
  if new.status not in ('draft', 'sent') then
    return new;
  end if;
  select * into q from public.quotes where id = new.quote_id;
  if q.client_decision = 'accepted' and (new.quote_version is distinct from q.client_version or new.options is not null) then
    raise exception 'the client accepted version % of this quote: the contract follows it', q.client_version using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger contracts_client_choice before insert or update of quote_id, quote_version, options on public.contracts
  for each row execute function private.check_contract_client_choice();

-- cancelling a contract made from the quote hands the client's link back to the quote (instead of
-- closing his page) and reopens the offer he had accepted, so the quote can be revised and answered
create or replace function private.contract_cancelled_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_valid date;
begin
  -- only a contract the client hasn't signed: cancelling a signed one closes the page as before
  if new.status = 'cancelled' and old.status in ('draft', 'sent') then
    select q.valid_until into v_valid from public.quotes q where q.id = new.quote_id;
    update public.client_portal_links l
    set contract_id = null, expires_at = private.quote_link_expiry(v_valid)
    where l.contract_id = new.id and l.quote_id is not null and l.revoked_at is null and l.expires_at > now();
    update public.quotes
    set client_decision = null, client_decided_at = null, client_version = null, client_name = null,
        client_note = null, client_ip = null, client_user_agent = null
    where id = new.quote_id and client_decision = 'accepted'
      and not exists (select 1 from public.contracts c where c.quote_id = new.quote_id and c.id <> new.id and c.status <> 'cancelled');
  end if;
  return null;
end;
$$;
create trigger contracts_cancelled_link after update of status on public.contracts
  for each row execute function private.contract_cancelled_link();
