-- =============================================================================
-- Review batch 3 (Nov 2026)
--   #18 record_client_payment: never more than the payment's amount (cumulative),
--       like record_addendum_payment.
--   #19 public.save_contract_schedule(): a draft/sent contract's dates and payment
--       schedule are rewritten in ONE step (no contract left without a schedule).
--   #20 subcontractor work: lump-sum shares total ≤ 100 %, per-m² area total ≤ the
--       agreed area (0.01 tolerance), no work on a closed agreement.
--   #21 push devices: public.claim_push_subscription() moves a device (endpoint) to the
--       caller — a shared iPad follows whoever turned notifications on last; sign-out
--       deletes the caller's own row (RLS, unchanged).
--   #22 progress updates / client notes must use a stage of the same contract.
--   #23 owner decision: staff MAY close a maintenance request (or the client after
--       "resolved"); staff closing is stamped (closed_by, closed_at) and shown on the
--       client page; users can't write those stamps themselves; reopening clears the
--       client's confirmation too.
--   review: public.create_contract() — a new contract and its payment schedule in ONE
--       transaction (invoker: the insert runs as the user, every RLS policy and contract
--       trigger applies exactly as before); defence: no client-page link and no acceptance
--       for a contract without payments.
-- Non-destructive: one new column, new functions, redefined functions/triggers.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- #18 record_client_payment: upper bound (copied from review_batch1; checks added)
-- ---------------------------------------------------------------------------
create or replace function public.record_client_payment(p_payment uuid, p_paid_on date, p_amount numeric, p_method text, p_reference text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.contract_payments;
  v_total numeric;
begin
  select * into p from public.contract_payments where id = p_payment for update;
  if p.id is null or not private.has_permission(p.organization_id, 'finance.manage')
     or not private.can_access_contract(p.organization_id, p.contract_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or p_paid_on is null or p_paid_on > current_date + 1
     or p_method not in ('transfer', 'cash', 'cheque', 'card') or char_length(p_reference) > 80 then
    raise exception 'invalid payment' using errcode = '22023';
  end if;
  if not exists (select 1 from public.contracts c where c.id = p.contract_id and c.status = 'accepted') then
    raise exception 'the contract isn''t accepted' using errcode = '22023';
  end if;
  if p.status = 'paid' then
    raise exception 'already paid' using errcode = '22023';
  end if;
  v_total := coalesce(p.paid_amount, 0) + p_amount;
  if v_total > p.amount + 0.005 then
    raise exception 'more than the amount due' using errcode = '22023';
  end if;
  update public.contract_payments
  set paid_amount = v_total, paid_at = p_paid_on, paid_method = p_method, paid_reference = nullif(trim(p_reference), ''),
      requested_at = coalesce(requested_at, now()),
      status = case when v_total >= amount - 0.005 then 'paid' else 'requested' end
  where id = p.id;
  return case when v_total >= p.amount - 0.005 then 'paid' else 'partial' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- #19 Dates + payment schedule of a draft/sent contract in one step.
--   Same rules as the app (contracts/actions.ts): 1–12 payments, label 1–120,
--   0 < percent ≤ 100, |Σ − 100| < 0.01 (sum rounded to 2 decimals), amounts from the
--   contract total, the last payment absorbs rounding.
-- ---------------------------------------------------------------------------
create or replace function public.save_contract_schedule(p_contract uuid, p_start date, p_duration int, p_warranty int, p_notes text, p_payments jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.contracts;
  v_n int;
  v_sum numeric;
  v_paid numeric := 0;
  v_amount numeric;
  r record;
begin
  select * into c from public.contracts where id = p_contract for update;
  if c.id is null or not private.has_permission(c.organization_id, 'quotes.manage')
     or not private.can_access_contract(c.organization_id, c.id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.status not in ('draft', 'sent') then
    raise exception 'the contract is locked (accepted or cancelled)' using errcode = '42501';
  end if;
  if p_payments is null or jsonb_typeof(p_payments) <> 'array' then
    raise exception 'invalid payment schedule' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_payments);
  if v_n < 1 or v_n > 12 or exists (
       select 1 from jsonb_array_elements(p_payments) e
       where jsonb_typeof(e) <> 'object'
          or jsonb_typeof(e -> 'percent') is distinct from 'number'
          or jsonb_typeof(e -> 'label') is distinct from 'string'
          or char_length(trim(e ->> 'label')) not between 1 and 120
          or (e ->> 'percent')::numeric <= 0 or (e ->> 'percent')::numeric > 100
          or coalesce(e ->> 'due_event', '') not in ('signing', 'material_supply', 'board_closing', 'primer_done', 'handover', 'custom')) then
    raise exception 'invalid payment schedule' using errcode = '22023';
  end if;
  select round(sum((e ->> 'percent')::numeric), 2) into v_sum from jsonb_array_elements(p_payments) e;
  if abs(v_sum - 100) >= 0.01 then
    raise exception 'invalid payment schedule: percentages must total 100 (%)', v_sum using errcode = '22023';
  end if;

  update public.contracts
  set start_date = p_start, duration_days = p_duration, warranty_months = p_warranty, notes = nullif(trim(p_notes), '')
  where id = c.id;

  delete from public.contract_payments where contract_id = c.id;
  for r in select e, ord::int as seq from jsonb_array_elements(p_payments) with ordinality as x(e, ord) order by ord loop
    if r.seq = v_n then
      v_amount := round(c.total - v_paid, 2);
    else
      v_amount := round(c.total * (r.e ->> 'percent')::numeric / 100, 2);
      v_paid := v_paid + v_amount;
    end if;
    insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event)
    values (c.organization_id, c.id, r.seq, trim(r.e ->> 'label'), (r.e ->> 'percent')::numeric, greatest(v_amount, 0), r.e ->> 'due_event');
  end loop;
end;
$$;
revoke all on function public.save_contract_schedule(uuid, date, int, int, text, jsonb) from public, anon;
grant execute on function public.save_contract_schedule(uuid, date, int, int, text, jsonb) to authenticated, service_role;

-- A NEW contract and its schedule in one transaction: if the schedule is refused, the contract
-- insert is rolled back with it (no draft without payments). SECURITY INVOKER on purpose: the
-- insert runs as the user, so RLS (quotes.manage, project access) and every trigger on contracts
-- (number, guard_contract, check_contract_quote — issued quote with nothing open, total from the
-- version —, options check) apply exactly as for a direct insert. What it inserts mirrors the
-- app's former path (contracts/actions.ts): the quote's current (or first offered) version,
-- its project type, the options, and the company's clause template.
create or replace function public.create_contract(p_quote uuid, p_start date, p_duration int, p_warranty int, p_notes text, p_payments jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  q public.quotes;
  v_version int;
  v_total numeric;
  v_selection jsonb;
  v_terms jsonb;
  v_id uuid;
  v_number text;
begin
  select * into q from public.quotes where id = p_quote;
  if q.id is null or q.status <> 'issued' then
    raise exception 'quote not issued' using errcode = '22023';
  end if;
  -- with options the client picks later; until then the contract shows the first one offered
  v_version := case
    when q.options is not null and jsonb_array_length(q.options) > 0 then
      case when exists (select 1 from jsonb_array_elements(q.options) e where (e ->> 'version')::int = q.current_version)
           then q.current_version else (q.options -> 0 ->> 'version')::int end
    else q.current_version end;
  select v.total, v.selection into v_total, v_selection from public.quote_versions v where v.quote_id = q.id and v.version = v_version;
  if v_total is null then
    raise exception 'quote version not found' using errcode = 'P0002';
  end if;
  select t.terms into v_terms from public.contract_templates t where t.organization_id = q.organization_id;
  insert into public.contracts (organization_id, quote_id, quote_version, options, client_id, service, project_type,
                                start_date, duration_days, warranty_months, total, notes, terms)
  values (q.organization_id, q.id, v_version, q.options, q.client_id, q.service,
          coalesce(v_selection -> 'options' ->> 'projectType', 'full'),
          p_start, p_duration, p_warranty, v_total, nullif(trim(p_notes), ''), coalesce(v_terms, '{}'::jsonb))
  returning id, number into v_id, v_number;
  perform public.save_contract_schedule(v_id, p_start, p_duration, p_warranty, p_notes, p_payments);
  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;
revoke all on function public.create_contract(uuid, date, int, int, text, jsonb) from public, anon;
grant execute on function public.create_contract(uuid, date, int, int, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- #20 Subcontractor work: cumulative caps (copied from phase 8; caps added).
--   The agreement row is locked so two entries at once can't both pass. The automatic
--   progress sync (private.sync_subcontractor_progress) already adds only the missing
--   part up to the agreement, so it always fits.
-- ---------------------------------------------------------------------------
create or replace function private.price_subcontractor_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.subcontractor_agreements;
  v_others numeric;
begin
  select * into g from public.subcontractor_agreements where id = new.agreement_id for update;
  if g.status = 'closed' then
    raise exception 'the agreement is closed' using errcode = '22023';
  end if;
  if g.basis = 'per_m2' then
    if new.quantity_m2 is null then
      raise exception 'enter the executed area' using errcode = '22023';
    end if;
    select coalesce(sum(w.quantity_m2), 0) into v_others from public.subcontractor_work w
    where w.agreement_id = g.id and w.id <> new.id;
    if v_others + new.quantity_m2 > coalesce(g.quantity_m2, 0) + 0.01 then
      raise exception 'more than the agreement (area)' using errcode = '22023';
    end if;
    new.percent := null;
    new.amount := round(new.quantity_m2 * g.rate, 2);
  else
    if new.percent is null then
      raise exception 'enter the share of the job done' using errcode = '22023';
    end if;
    select coalesce(sum(w.percent), 0) into v_others from public.subcontractor_work w
    where w.agreement_id = g.id and w.id <> new.id;
    if v_others + new.percent > 100.01 then
      raise exception 'more than the agreement (share)' using errcode = '22023';
    end if;
    new.quantity_m2 := null;
    new.amount := round(g.rate * new.percent / 100, 2);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- #21 A push device belongs to whoever turned it on last (shared iPad).
--   The caller proves possession by holding the browser's subscription (endpoint + keys);
--   he can only claim it for himself, in an organization he belongs to.
-- ---------------------------------------------------------------------------
create or replace function public.claim_push_subscription(p_org uuid, p_endpoint text, p_p256dh text, p_auth text, p_device text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or p_org is null or not private.is_member(p_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (organization_id, user_id, endpoint, p256dh, auth, device)
  values (p_org, auth.uid(), p_endpoint, p_p256dh, p_auth, nullif(trim(p_device), ''))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.claim_push_subscription(uuid, text, text, text, text) from public, anon;
grant execute on function public.claim_push_subscription(uuid, text, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- #22 A stage referenced by a progress update or client note must be this contract's
--   (copied from execution.sql; the stage/contract check added).
-- ---------------------------------------------------------------------------
create or replace function private.check_phase7_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  j jsonb := to_jsonb(new);
  ref record;
  v_org uuid;
begin
  for ref in select * from (values ('contract_id', 'contracts'), ('stage_id', 'project_stages')) as r(col, tbl) loop
    if j ? ref.col and j ->> ref.col is not null then
      execute format('select organization_id from public.%I where id = $1', ref.tbl) into v_org using (j ->> ref.col)::uuid;
      if v_org is distinct from new.organization_id then
        raise exception '% belongs to another organization', ref.col using errcode = '42501';
      end if;
    end if;
  end loop;
  if j ? 'stage_id' and j ->> 'stage_id' is not null and not exists (
    select 1 from public.project_stages s where s.id = (j ->> 'stage_id')::uuid and s.contract_id = (j ->> 'contract_id')::uuid
  ) then
    raise exception 'the stage belongs to another contract' using errcode = '42501';
  end if;
  -- photos must live under this organization's folder for this contract
  if j ? 'photos' and exists (
    select 1 from jsonb_array_elements_text(j -> 'photos') p
    where p.value !~ ('^' || new.organization_id::text || '/' || (j ->> 'contract_id') || '/(client/)?[0-9a-f-]{36}\.jpg$')
  ) then
    raise exception 'invalid photo path' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- #23 Maintenance: closed by staff or the client (owner decision, Nov 2026).
--   closed_by = the staff member who closed / rejected it; null when the client closed it
--   (client_confirmed_at) or it is open. Stamps are set here only (copied from
--   warranty_maintenance.sql; stamps protected, closed_by added).
-- ---------------------------------------------------------------------------
alter table public.maintenance_requests add column closed_by uuid references auth.users (id) on delete set null;

create or replace function private.guard_maintenance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_user boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'INSERT' then
    select organization_id into v_org from public.contracts where id = new.contract_id and status = 'accepted';
    if v_org is distinct from new.organization_id then
      raise exception 'contract not found' using errcode = '42501';
    end if;
    if v_user then
      new.source := 'staff';
      new.status := 'open';
      new.client_confirmed_at := null;
      new.resolved_at := null;
      new.closed_at := null;
      new.closed_by := null;
    end if;
  elsif v_user then
    if new.contract_id is distinct from old.contract_id or new.body is distinct from old.body or new.photos is distinct from old.photos
       or new.source is distinct from old.source or new.client_confirmed_at is distinct from old.client_confirmed_at
       or new.organization_id is distinct from old.organization_id then
      raise exception 'the request itself can''t change' using errcode = '42501';
    end if;
    -- the stamps follow the status only
    new.resolved_at := old.resolved_at;
    new.closed_at := old.closed_at;
    new.closed_by := old.closed_by;
  end if;
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists (select 1 from public.memberships m where m.organization_id = new.organization_id and m.user_id = new.assigned_to and m.status = 'active') then
    raise exception 'assignee is not a member' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'resolved' then
      new.resolved_at := now();
      new.closed_at := null;
      new.closed_by := null;
    elsif new.status in ('closed', 'rejected') then
      new.closed_at := now();
      -- staff closing (the client's own close comes through portal_confirm_maintenance)
      new.closed_by := case when v_user then auth.uid() end;
    elsif new.status in ('open', 'in_progress') then
      -- reopened: the client's earlier confirmation no longer stands (a later staff close
      -- must not read as his)
      new.resolved_at := null;
      new.closed_at := null;
      new.closed_by := null;
      new.client_confirmed_at := null;
    end if;
  end if;
  return new;
end;
$$;

-- Client page: when and by whom (staff or the client) a request was closed / rejected
-- (copied from warranty_maintenance.sql; closed_at / closed_by_staff = closed_by is set added).
create or replace function public.portal_warranty(p_number text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
  v_handover timestamptz;
  v_end date;
begin
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null then
    return null;
  end if;
  v_handover := private.handover_at(v_link.contract_id);
  v_end := private.warranty_end(v_link.contract_id);
  return jsonb_build_object(
    'org_id', v_link.organization_id,
    'contract_id', v_link.contract_id,
    'handover_at', v_handover,
    'warranty_end', v_end,
    'active', v_end is not null and (now() at time zone 'Asia/Riyadh')::date <= v_end,
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'number', m.number, 'body', m.body, 'photos', to_jsonb(m.photos), 'status', m.status,
        'reply', m.reply, 'created_at', m.created_at, 'resolved_at', m.resolved_at, 'client_confirmed_at', m.client_confirmed_at,
        'closed_at', m.closed_at, 'closed_by_staff', m.status in ('closed', 'rejected') and m.closed_by is not null) order by m.created_at desc)
      from public.maintenance_requests m where m.contract_id = v_link.contract_id), '[]'::jsonb));
end;
$$;
revoke all on function public.portal_warranty(text, text) from public, anon, authenticated;
grant execute on function public.portal_warranty(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Defence: a contract without a payment schedule never reaches the client
--   (copied from review_batch2 / review_batch1; the contract_payments check added).
-- ---------------------------------------------------------------------------
create or replace function public.issue_portal_link(p_contract uuid, p_token_hash text, p_expires timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.contracts;
  v_id uuid;
begin
  select * into c from public.contracts where id = p_contract for update;
  if c.id is null or not private.has_permission(c.organization_id, 'quotes.manage') or not private.can_access_contract(c.organization_id, c.id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.status = 'cancelled' or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_expires is null or p_expires <= now() or p_expires > now() + interval '3 years' then
    raise exception 'invalid link' using errcode = '22023';
  end if;
  if not exists (select 1 from public.contract_payments p where p.contract_id = c.id) then
    raise exception 'no payment schedule' using errcode = '22023';
  end if;
  insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at)
  values (c.organization_id, c.id, p_token_hash, p_expires)
  returning id into v_id;
  update public.client_portal_links set revoked_at = now()
  where contract_id = c.id and revoked_at is null and id <> v_id;
  return v_id;
end;
$$;
revoke all on function public.issue_portal_link(uuid, text, timestamptz) from public, anon;
grant execute on function public.issue_portal_link(uuid, text, timestamptz) to authenticated;

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
$$;
revoke all on function public.portal_accept(text, text, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.portal_accept(text, text, text, text, text, text, int) to service_role;
