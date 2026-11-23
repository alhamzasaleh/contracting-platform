-- =============================================================================
-- Review batch 1 (Nov 2026) — money & security fixes. Non-destructive.
--   #1 Addendum payments only through public.record_addendum_payment() (cumulative,
--      partial stays "requested", never above the total, method/reference on the
--      receipt); notifications and late reminders for addenda too.
--   #2 Signing payments are requested when the client accepts; staff request
--      material-supply / custom payments with public.request_contract_payment().
--   #3 Quotes become "issued" only through public.issue_quote() (open approvals and
--      approvals for low margin / discounts are checked); a contract needs an issued
--      quote and takes its total from the quote version.
--   #4 Superseded quote approvals are cancelled by the database; an accepted quote
--      never goes back.
--   #5 Payroll advances are settled by the amount actually deducted (oldest first);
--      the rest carries to the next month.
--   #6 Per-project access in move_stock / submit_purchase / submit_addendum /
--      payments / warranties; restrictive policies on purchase_lines,
--      subcontractor_work and subcontractor_payments; notifications carry their
--      contract explicitly and link to the item.
--   #8 In-house labour actual cost: scheduled work days (up to today) of in-house
--      teams × the members' fully loaded cost per worker-day (same formula as
--      employeeCost() in src/lib/costing). Totals only; needs hr.view (built from
--      salaries). An employee booked on several projects the same day (in one or more
--      teams) is shared equally between them.
--   Review of this batch: legacy "paid" addenda can't be paid again; payments whose
--      stage isn't on the project can be requested; unpriced versions can't be issued
--      (quote_versions.problems) and an accepted quote's version is frozen; signing
--      backfill dated at acceptance; alert links to the screen that explains them;
--      private helpers open to signed-in users answer only for their own organizations.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- #6 notify(): the contract can be given explicitly (links are no longer parsed
-- when it is); a second permission can be required (profit alerts: costs.view + hr.view).
-- ---------------------------------------------------------------------------
drop function private.notify(uuid, text, text, jsonb, text, text);
create or replace function private.notify(p_org uuid, p_permission text, p_kind text, p_params jsonb, p_link text, p_dedupe text default null, p_contract uuid default null,
                                          p_also_permission text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
  v_id uuid;
  v_pref public.notification_preferences;
  v_phone text;
  v_contract uuid := coalesce(p_contract, private.link_contract(p_org, p_link));
begin
  for m in select ms.user_id from public.memberships ms
           where ms.organization_id = p_org and ms.status = 'active' loop
    if not (p_permission = any (private.member_permissions(p_org, m.user_id)))
       or (p_also_permission is not null and not (p_also_permission = any (private.member_permissions(p_org, m.user_id)))) then
      continue;
    end if;
    if v_contract is not null and not private.member_can_access(p_org, m.user_id, v_contract) then
      continue;
    end if;
    select * into v_pref from public.notification_preferences where organization_id = p_org and user_id = m.user_id and kind = p_kind;
    if v_pref.kind is null or v_pref.in_app then
      insert into public.notifications (organization_id, user_id, kind, params, link, dedupe_key)
      values (p_org, m.user_id, p_kind, coalesce(p_params, '{}'::jsonb), p_link, p_dedupe)
      on conflict (user_id, dedupe_key) do nothing
      returning id into v_id;
    else
      v_id := null;
    end if;
    if v_id is null then
      continue;
    end if;
    if v_pref.whatsapp then
      select p.phone into v_phone from public.profiles p where p.id = m.user_id;
      if v_phone ~ '^[0-9]{8,15}$' then
        insert into public.notification_deliveries (notification_id, organization_id, phone) values (v_id, p_org, v_phone);
      end if;
    end if;
    if (v_pref.kind is null or v_pref.push)
       and exists (select 1 from public.push_subscriptions s where s.user_id = m.user_id and s.organization_id = p_org) then
      insert into public.notification_deliveries (notification_id, organization_id, channel, user_id) values (v_id, p_org, 'push', m.user_id);
    end if;
  end loop;
end;
$$;
revoke all on function private.notify(uuid, text, text, jsonb, text, text, uuid, text) from public;

-- Where an approval is decided: the item's page and its project (if any).
create or replace function private.approval_target(p_entity text, p_entity_id uuid, out link text, out contract_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_entity = 'quote' then
    select '/quotations/' || q.number, null::uuid into link, contract_id from public.quotes q where q.id = p_entity_id;
  elsif p_entity = 'purchase' then
    select '/purchases/' || p.number, p.contract_id into link, contract_id from public.purchases p where p.id = p_entity_id;
  elsif p_entity = 'addendum' then
    select '/contracts/' || c.number, c.id into link, contract_id
    from public.addenda a join public.contracts c on c.id = a.contract_id where a.id = p_entity_id;
  end if;
  link := coalesce(link, '/');
end;
$$;
revoke all on function private.approval_target(text, uuid) from public;

create or replace function private.notify_on_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  if new.status = 'pending' then
    select * into t from private.approval_target(new.entity, new.entity_id);
    perform private.notify(new.organization_id, 'approvals.decide', 'approval',
      jsonb_build_object('approval_id', new.id, 'kind', new.kind, 'number', new.details ->> 'number', 'total', new.details -> 'total'),
      t.link, 'approval:' || new.id, t.contract_id);
  end if;
  return null;
end;
$$;

create or replace function private.notify_on_client_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text;
begin
  select number into v_number from public.contracts where id = new.contract_id;
  perform private.notify(new.organization_id, 'projects.manage', 'client_note',
    jsonb_build_object('number', v_number, 'body', left(new.body, 120)), '/projects/' || v_number, 'note:' || new.id, new.contract_id);
  return null;
end;
$$;

create or replace function private.notify_on_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text;
begin
  if new.status = 'confirmed' and old.status <> 'confirmed' then
    select number into v_number from public.contracts where id = new.contract_id;
    perform private.notify(new.organization_id, 'projects.view', 'stage_confirmed',
      jsonb_build_object('number', v_number, 'stage', new.name, 'final', new.is_final), '/projects/' || v_number, 'stage:' || new.id, new.contract_id);
  end if;
  return null;
end;
$$;

create or replace function private.notify_on_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and old.status <> 'accepted' then
    perform private.notify(new.organization_id, 'quotes.view', 'contract_accepted',
      jsonb_build_object('number', new.number, 'name', new.accepted_name), '/contracts/' || new.number, 'contract:' || new.id, new.id);
  end if;
  return null;
end;
$$;

create or replace function private.notify_on_addendum()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text;
begin
  if new.status = 'accepted' and old.status <> 'accepted' then
    select number into v_number from public.contracts where id = new.contract_id;
    perform private.notify(new.organization_id, 'quotes.view', 'addendum_accepted',
      jsonb_build_object('number', new.number, 'title', new.title), '/contracts/' || v_number, 'addendum:' || new.id, new.contract_id);
  end if;
  return null;
end;
$$;

create or replace function private.notify_on_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text;
begin
  if new.paid_amount is distinct from old.paid_amount and coalesce(new.paid_amount, 0) > coalesce(old.paid_amount, 0) then
    select number into v_number from public.contracts where id = new.contract_id;
    perform private.notify(new.organization_id, 'finance.view', 'payment_received',
      jsonb_build_object('number', v_number, 'label', new.label, 'amount', new.paid_amount - coalesce(old.paid_amount, 0)),
      '/reports', 'paid:' || new.id || ':' || new.paid_amount, new.contract_id);
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- #1 Addendum payments
-- ---------------------------------------------------------------------------
alter table public.addenda
  add column if not exists paid_method text check (paid_method in ('transfer', 'cash', 'cheque', 'card')),
  add column if not exists paid_reference text check (char_length(paid_reference) <= 80);

-- Staff never write the payment fields: money goes through record_addendum_payment.
create or replace function private.guard_addendum_payment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.paid_amount is not null or new.paid_at is not null or new.paid_method is not null or new.paid_reference is not null then
      raise exception 'addendum payments are recorded through record_addendum_payment' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.payment_status is distinct from old.payment_status or new.paid_amount is distinct from old.paid_amount
     or new.paid_at is distinct from old.paid_at or new.paid_method is distinct from old.paid_method
     or new.paid_reference is distinct from old.paid_reference then
    raise exception 'addendum payments are recorded through record_addendum_payment' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger addenda_payment_guard before insert or update on public.addenda
  for each row execute function private.guard_addendum_payment();

create or replace function public.record_addendum_payment(p_addendum uuid, p_paid_on date, p_amount numeric, p_method text, p_reference text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.addenda;
  v_total numeric;
begin
  select * into a from public.addenda where id = p_addendum for update;
  if a.id is null or not private.has_permission(a.organization_id, 'finance.manage')
     or not private.can_access_contract(a.organization_id, a.contract_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or p_paid_on is null or p_paid_on > current_date + 1
     or p_method is null or p_method not in ('transfer', 'cash', 'cheque', 'card') or char_length(p_reference) > 80 then
    raise exception 'invalid payment' using errcode = '22023';
  end if;
  if a.status <> 'accepted' then
    raise exception 'the addendum isn''t accepted' using errcode = '22023';
  end if;
  -- also rows marked paid before amounts were recorded (paid_amount null)
  if a.payment_status = 'paid' then
    raise exception 'already paid' using errcode = '22023';
  end if;
  v_total := coalesce(a.paid_amount, 0) + p_amount;
  if v_total > a.total + 0.005 then
    raise exception 'more than the amount due' using errcode = '22023';
  end if;
  update public.addenda
  set paid_amount = v_total, paid_at = p_paid_on, paid_method = p_method, paid_reference = nullif(trim(p_reference), ''),
      payment_status = case when v_total >= a.total - 0.005 then 'paid' else 'requested' end
  where id = a.id;
  return case when v_total >= a.total - 0.005 then 'paid' else 'partial' end;
end;
$$;
revoke all on function public.record_addendum_payment(uuid, date, numeric, text, text) from public, anon;
grant execute on function public.record_addendum_payment(uuid, date, numeric, text, text) to authenticated, service_role;

create or replace function private.receipt_on_addendum()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.paid_amount, 0) > coalesce(old.paid_amount, 0) then
    insert into public.client_receipts (organization_id, contract_id, addendum_id, label, amount, paid_on, method, reference)
    values (new.organization_id, new.contract_id, new.id, new.number || ' — ' || new.title, new.paid_amount - coalesce(old.paid_amount, 0),
            coalesce(new.paid_at, (now() at time zone 'Asia/Riyadh')::date), new.paid_method, new.paid_reference);
  end if;
  return null;
end;
$$;

create or replace function private.notify_on_addendum_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text;
begin
  if coalesce(new.paid_amount, 0) > coalesce(old.paid_amount, 0) then
    select number into v_number from public.contracts where id = new.contract_id;
    perform private.notify(new.organization_id, 'finance.view', 'payment_received',
      jsonb_build_object('number', v_number, 'label', new.number || ' — ' || new.title, 'amount', new.paid_amount - coalesce(old.paid_amount, 0)),
      '/reports', 'paid:ad:' || new.id || ':' || new.paid_amount, new.contract_id);
  end if;
  return null;
end;
$$;
create trigger addenda_payment_notify after update of paid_amount on public.addenda
  for each row execute function private.notify_on_addendum_payment();

-- Finance recording money checks the project too (#6); otherwise unchanged.
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
  v_total := coalesce(p.paid_amount, 0) + p_amount;
  update public.contract_payments
  set paid_amount = v_total, paid_at = p_paid_on, paid_method = p_method, paid_reference = nullif(trim(p_reference), ''),
      requested_at = coalesce(requested_at, now()),
      status = case when v_total >= amount - 0.005 then 'paid' else 'requested' end
  where id = p.id;
  return case when v_total >= p.amount - 0.005 then 'paid' else 'partial' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- #2 Payments requested on signing / by staff
-- ---------------------------------------------------------------------------
create or replace function private.on_contract_accepted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    perform private.create_project_stages(new.id);
    -- §3.7: the payment due on signing is requested now (invoice, collections, reminders)
    update public.contract_payments set status = 'requested'
    where contract_id = new.id and due_event = 'signing' and status = 'pending';
  end if;
  return new;
end;
$$;

-- Accepted contracts whose signing payment was never requested (before this fix).
-- Dated at the acceptance (stamp_payment_request keeps an existing requested_at; the invoice uses it).
update public.contract_payments p set status = 'requested', requested_at = coalesce(c.accepted_at, now())
from public.contracts c
where c.id = p.contract_id and c.status = 'accepted' and p.due_event = 'signing' and p.status = 'pending';

-- Material supply / custom payments: staff request them (stage payments follow the client's confirmation).
-- Why a payment can't be requested now (null = it can). One rule for request_contract_payment and
-- requestable_payments (the button the app shows).
create or replace function private.payment_request_block(p public.contract_payments)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (select 1 from public.contracts c where c.id = p.contract_id and c.status = 'accepted') then 'the contract isn''t accepted'
    -- stage payments follow the client's confirmation, unless the project has no such stage
    when p.due_event = 'signing'
         or (p.due_event not in ('material_supply', 'custom')
             and exists (select 1 from public.project_stages s where s.contract_id = p.contract_id and s.payment_event = p.due_event))
      then 'stage payments are requested when the client confirms the stage'
    when p.status <> 'pending' then 'already requested'
  end
$$;
revoke all on function private.payment_request_block(public.contract_payments) from public;

create or replace function public.request_contract_payment(p_payment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.contract_payments;
  v_block text;
begin
  select * into p from public.contract_payments where id = p_payment for update;
  if p.id is null
     or not (private.has_permission(p.organization_id, 'finance.manage') or private.has_permission(p.organization_id, 'quotes.manage'))
     or not private.can_access_contract(p.organization_id, p.contract_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_block := private.payment_request_block(p);
  if v_block is not null then
    raise exception '%', v_block using errcode = '22023';
  end if;
  update public.contract_payments set status = 'requested' where id = p.id;
end;
$$;
revoke all on function public.request_contract_payment(uuid) from public, anon;
grant execute on function public.request_contract_payment(uuid) to authenticated, service_role;

-- The payments the caller may request now (exactly what request_contract_payment accepts), so the
-- app shows the button even when the user can't read the project's stages. Nothing for users
-- who can't request payments or can't see the project.
create or replace function public.requestable_payments(p_org uuid, p_contract uuid default null)
returns table (payment_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.contract_payments p
  where p.organization_id = p_org and (p_contract is null or p.contract_id = p_contract)
    and p.status = 'pending'
    and (private.has_permission(p_org, 'finance.manage') or private.has_permission(p_org, 'quotes.manage'))
    and private.can_access_contract(p_org, p.contract_id)
    and private.payment_request_block(p) is null
$$;
revoke all on function public.requestable_payments(uuid, uuid) from public, anon;
grant execute on function public.requestable_payments(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- #3 / #4 Quotes: issue only through issue_quote; approvals superseded by the DB
-- ---------------------------------------------------------------------------
-- Unpriced items in a version (recomputed on the server when it is saved).
alter table public.quote_versions
  add column if not exists problems int not null default 0 check (problems >= 0);

create or replace function private.guard_quote()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- what the client accepted stays: no new version (saving one moves current_version), whoever saves it
  if tg_op = 'UPDATE' and old.status = 'accepted' and new.current_version is distinct from old.current_version then
    raise exception 'an accepted quote can''t change' using errcode = '42501';
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
    return new;
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
create trigger quotes_guard before insert or update on public.quotes
  for each row execute function private.guard_quote();

-- A contract sent to the client freezes its quote: no new version, no other options, until the
-- client accepts (the acceptance itself moves the quote to the agreed version) or the contract
-- is cancelled. Definer: the check must see the contract whatever the user may read.
create or replace function private.guard_quote_sent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.current_version is distinct from old.current_version or new.options is distinct from old.options)
     and new.status is distinct from 'accepted'
     and exists (select 1 from public.contracts c where c.quote_id = new.id and c.status in ('draft', 'sent')) then
    raise exception 'a contract was made from this quote: the quote can''t change (sent to the client)' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger quotes_guard_sent before update on public.quotes
  for each row execute function private.guard_quote_sent();

-- Acceptance keeps quotes.current_version = the contract's (chosen) version.
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

-- The versions a quote offers: its options, or its current version.
create or replace function private.offered_versions(p_quote uuid)
returns int[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when q.options is not null
              then array(select (e ->> 'version')::int from jsonb_array_elements(q.options) e)
              else array[q.current_version] end
  from public.quotes q where q.id = p_quote
$$;
revoke all on function private.offered_versions(uuid) from public;

create or replace function public.issue_quote(p_quote uuid, p_valid_until date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
end;
$$;
revoke all on function public.issue_quote(uuid, date) from public, anon;
grant execute on function public.issue_quote(uuid, date) to authenticated, service_role;

-- Pending approvals of versions no longer offered are cancelled (whoever saves the new version).
create or replace function private.supersede_quote_approvals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote uuid := case when tg_table_name = 'quotes' then (to_jsonb(new) ->> 'id')::uuid else (to_jsonb(new) ->> 'quote_id')::uuid end;
  v_keep text[];
begin
  select array(select unnest(coalesce(private.offered_versions(v_quote), '{}'::int[]) || q.current_version)::text)
  into v_keep from public.quotes q where q.id = v_quote;
  update public.approvals a set status = 'cancelled'
  where a.entity = 'quote' and a.entity_id = v_quote and a.status = 'pending'
    and not (coalesce(a.details ->> 'version', '') = any (v_keep));
  return null;
end;
$$;
create trigger quote_versions_supersede after insert on public.quote_versions
  for each row execute function private.supersede_quote_approvals();
create trigger quotes_options_supersede after update of options on public.quotes
  for each row execute function private.supersede_quote_approvals();

-- Contracts: from an issued quote with nothing waiting for approval; the total is the version's.
-- The helpers below are callable by signed-in users (the trigger runs as them): they answer
-- only about rows of the caller's own organizations.
create or replace function private.check_contract_quote()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total numeric;
  v_status text;
  v_versions int[];
begin
  if current_user not in ('authenticated', 'anon') or new.status not in ('draft', 'sent') then
    return new;
  end if;
  select private.quote_version_total(new.quote_id, new.quote_version) into v_total;
  if v_total is null then
    raise exception 'the contract must point to a version of its quote' using errcode = '22023';
  end if;
  new.total := v_total;
  if tg_op = 'INSERT' or new.quote_id is distinct from old.quote_id or new.quote_version is distinct from old.quote_version
     or new.options is distinct from old.options then
    v_status := private.quote_status(new.quote_id);
    if v_status is distinct from 'issued' then
      raise exception 'a contract needs an issued quote' using errcode = '22023';
    end if;
    v_versions := case when new.options is not null
                       then array(select (e ->> 'version')::int from jsonb_array_elements(new.options) e)
                       else array[new.quote_version] end;
    if private.quote_has_open_approvals(new.quote_id, v_versions) then
      raise exception 'waiting for the owner''s approval' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.quote_version_total(p_quote uuid, p_version int)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select v.total from public.quote_versions v where v.quote_id = p_quote and v.version = p_version and private.is_member(v.organization_id)
$$;
create or replace function private.quote_status(p_quote uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select q.status from public.quotes q where q.id = p_quote and private.is_member(q.organization_id)
$$;
create or replace function private.quote_has_open_approvals(p_quote uuid, p_versions int[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.approvals a where a.entity = 'quote' and a.entity_id = p_quote
                 and a.status in ('pending', 'rejected') and a.details ->> 'version' = any (select unnest(p_versions)::text)
                 and private.is_member(a.organization_id))
$$;
revoke all on function private.quote_version_total(uuid, int), private.quote_status(uuid), private.quote_has_open_approvals(uuid, int[]) from public;
grant execute on function private.quote_version_total(uuid, int), private.quote_status(uuid), private.quote_has_open_approvals(uuid, int[]) to authenticated;

create trigger contracts_quote_check before insert or update on public.contracts
  for each row execute function private.check_contract_quote();

-- ---------------------------------------------------------------------------
-- #5 Payroll advances: settled by the amount deducted
-- ---------------------------------------------------------------------------
alter table public.employee_advances
  add column if not exists deducted_amount numeric(12, 2) not null default 0 check (deducted_amount >= 0);
update public.employee_advances set deducted_amount = amount where deducted_in_run is not null and deducted_amount = 0;
alter table public.employee_advances add constraint employee_advances_deducted_le check (deducted_amount <= amount);

create or replace function private.guard_employee_advance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    if new.deducted_amount <> 0 or new.deducted_in_run is not null then
      raise exception 'advances are settled by the payroll' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.deducted_amount > 0 or old.deducted_in_run is not null then
    raise exception 'a deducted advance can''t change' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.deducted_amount is distinct from old.deducted_amount or new.deducted_in_run is distinct from old.deducted_in_run then
    raise exception 'advances are settled by the payroll' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger employee_advances_guard before insert or update or delete on public.employee_advances
  for each row execute function private.guard_employee_advance();

create or replace function public.create_payroll_run(p_org uuid, p_month date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run uuid;
  v_month date := date_trunc('month', p_month)::date;
begin
  if not private.has_permission(p_org, 'hr.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select id into v_run from public.payroll_runs where organization_id = p_org and month = v_month;
  if v_run is not null then
    return v_run;
  end if;
  insert into public.payroll_runs (organization_id, month) values (p_org, v_month) returning id into v_run;
  insert into public.payroll_lines (organization_id, run_id, employee_id, full_name, iban, basic, housing, transport, other, advances)
  select p_org, v_run, e.id, e.full_name, e.iban, e.basic_salary, e.housing_allowance, e.transport_allowance, e.other_allowances,
         coalesce((select sum(a.amount - a.deducted_amount) from public.employee_advances a where a.employee_id = e.id and a.deducted_in_run is null), 0)
  from public.employees e
  where e.organization_id = p_org and e.status in ('active', 'on_leave');
  return v_run;
end;
$$;

create or replace function public.approve_payroll_run(p_run uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.payroll_runs;
  l record;
  a record;
  v_left numeric;
  v_take numeric;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.id is null or not private.has_permission(r.organization_id, 'hr.manage') or not private.has_permission(r.organization_id, 'approvals.decide') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if r.status <> 'draft' then
    raise exception 'already approved' using errcode = '22023';
  end if;
  -- each line settles its own deduction, oldest advance first; what isn't deducted stays open
  for l in select employee_id, advances from public.payroll_lines where run_id = r.id and advances > 0 loop
    v_left := l.advances;
    if v_left > coalesce((select sum(x.amount - x.deducted_amount) from public.employee_advances x
                          where x.employee_id = l.employee_id and x.organization_id = r.organization_id and x.deducted_in_run is null), 0) + 0.005 then
      raise exception 'the advances on a line exceed the employee''s open advances' using errcode = '22023';
    end if;
    for a in select x.id, x.amount, x.deducted_amount from public.employee_advances x
             where x.employee_id = l.employee_id and x.organization_id = r.organization_id and x.deducted_in_run is null
             order by x.given_on, x.created_at, x.id for update loop
      exit when v_left <= 0.005;
      v_take := least(v_left, a.amount - a.deducted_amount);
      update public.employee_advances
      set deducted_amount = a.deducted_amount + v_take,
          deducted_in_run = case when a.deducted_amount + v_take >= a.amount - 0.005 then r.id end
      where id = a.id;
      v_left := v_left - v_take;
    end loop;
  end loop;
  update public.payroll_runs set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = r.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- #6 Per-project access
-- ---------------------------------------------------------------------------
create or replace function private.purchase_contract(p_purchase uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.contract_id from public.purchases p where p.id = p_purchase and private.is_member(p.organization_id)
$$;
create or replace function private.agreement_contract(p_agreement uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.contract_id from public.subcontractor_agreements g where g.id = p_agreement and private.is_member(g.organization_id)
$$;
revoke all on function private.purchase_contract(uuid), private.agreement_contract(uuid) from public;
-- (own organizations only: they back the restrictive policies below, which run as the user)
grant execute on function private.purchase_contract(uuid), private.agreement_contract(uuid) to authenticated;

create policy purchase_lines_project_scope on public.purchase_lines as restrictive for all to authenticated
  using (private.purchase_contract(purchase_id) is null or private.can_access_contract(organization_id, private.purchase_contract(purchase_id)))
  with check (private.purchase_contract(purchase_id) is null or private.can_access_contract(organization_id, private.purchase_contract(purchase_id)));
create policy subcontractor_work_project_scope on public.subcontractor_work as restrictive for all to authenticated
  using (private.can_access_contract(organization_id, private.agreement_contract(agreement_id)))
  with check (private.can_access_contract(organization_id, private.agreement_contract(agreement_id)));
create policy subcontractor_payments_project_scope on public.subcontractor_payments as restrictive for all to authenticated
  using (private.can_access_contract(organization_id, private.agreement_contract(agreement_id)))
  with check (private.can_access_contract(organization_id, private.agreement_contract(agreement_id)));

create or replace function public.move_stock(p_item uuid, p_quantity numeric, p_from uuid, p_to uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.inventory_items;
  v_group uuid := gen_random_uuid();
  v_cost numeric;
  v_kind text;
begin
  select * into i from public.inventory_items where id = p_item;
  if i.id is null or not private.has_permission(i.organization_id, 'purchases.manage')
     or (p_from is not null and not private.can_access_contract(i.organization_id, p_from))
     or (p_to is not null and not private.can_access_contract(i.organization_id, p_to)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_from is not distinct from p_to then
    raise exception 'invalid movement' using errcode = '22023';
  end if;
  if p_to is null and not i.is_general then
    raise exception 'project-specific material stays on its project' using errcode = '22023';
  end if;
  if char_length(p_note) > 300 then
    raise exception 'note too long' using errcode = '22023';
  end if;
  if exists (select 1 from public.contracts c where c.id in (p_from, p_to) and (c.organization_id <> i.organization_id or c.status = 'cancelled')) then
    raise exception 'invalid project' using errcode = '42501';
  end if;
  v_kind := case when p_from is null then 'issue' when p_to is null then 'return' else 'transfer' end;
  v_cost := round(private.average_cost(p_item, p_from), 4);
  insert into public.inventory_movements (organization_id, item_id, contract_id, kind, quantity, unit_cost, transfer_group, note)
  values (i.organization_id, p_item, p_from, v_kind, -p_quantity, v_cost, v_group, p_note),
         (i.organization_id, p_item, p_to, v_kind, p_quantity, v_cost, v_group, p_note);
  return v_group;
end;
$$;

create or replace function public.submit_purchase(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.purchases;
  v_limit numeric;
  v_sub numeric;
  v_lines int;
begin
  select * into p from public.purchases where id = p_id for update;
  if p.id is null or not private.has_permission(p.organization_id, 'purchases.manage')
     or (p.contract_id is not null and not private.can_access_contract(p.organization_id, p.contract_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p.status not in ('draft', 'rejected') then
    raise exception 'already submitted' using errcode = '22023';
  end if;
  select count(*), coalesce(sum(amount), 0) into v_lines, v_sub from public.purchase_lines where purchase_id = p_id;
  if v_lines = 0 then
    raise exception 'a purchase needs at least one line' using errcode = '22023';
  end if;
  if abs(v_sub - p.subtotal) > 0.05 or abs(p.subtotal + p.vat - p.total) > 0.05 then
    raise exception 'totals don''t add up' using errcode = '22023';
  end if;
  if p.contract_id is not null and exists (select 1 from public.contracts c where c.id = p.contract_id and c.status = 'cancelled') then
    raise exception 'the project is cancelled' using errcode = '22023';
  end if;

  select s.purchase_approval_limit into v_limit from public.pricing_settings s where s.organization_id = p.organization_id;
  if v_limit is not null and p.total > v_limit and not private.has_permission(p.organization_id, 'approvals.decide') then
    update public.approvals set status = 'cancelled' where entity = 'purchase' and entity_id = p_id and status = 'pending';
    insert into public.approvals (organization_id, kind, entity, entity_id, details)
    values (p.organization_id, 'purchase_limit', 'purchase', p_id,
            jsonb_build_object('number', p.number, 'total', p.total, 'limit', v_limit, 'supplier', p.supplier_name));
    update public.purchases set status = 'pending_approval' where id = p_id;
    return 'pending_approval';
  end if;
  perform private.post_purchase(p_id);
  return 'recorded';
end;
$$;

create or replace function public.submit_addendum(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.addenda;
  v_contract text;
begin
  select * into a from public.addenda where id = p_id for update;
  if a.id is null or not private.has_permission(a.organization_id, 'quotes.manage')
     or not private.can_access_contract(a.organization_id, a.contract_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.status not in ('draft', 'rejected') then
    raise exception 'already submitted' using errcode = '22023';
  end if;
  if private.has_permission(a.organization_id, 'approvals.decide') then
    update public.addenda set status = 'approved' where id = p_id;
    return 'approved';
  end if;
  select c.number into v_contract from public.contracts c where c.id = a.contract_id;
  update public.approvals set status = 'cancelled' where entity = 'addendum' and entity_id = p_id and status = 'pending';
  insert into public.approvals (organization_id, kind, entity, entity_id, details)
  values (a.organization_id, 'addendum', 'addendum', p_id, jsonb_build_object('number', a.number, 'title', a.title, 'total', a.total, 'extra_days', a.extra_days, 'contract', v_contract));
  update public.addenda set status = 'pending_approval' where id = p_id;
  return 'pending_approval';
end;
$$;

create or replace function public.record_purchase_payment(p_purchase uuid, p_date date, p_from text, p_reference text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.purchases;
begin
  select * into p from public.purchases where id = p_purchase for update;
  if p.id is null or not private.has_permission(p.organization_id, 'finance.manage')
     or (p.contract_id is not null and not private.can_access_contract(p.organization_id, p.contract_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p.status <> 'recorded' then
    raise exception 'only recorded purchases can be paid' using errcode = '22023';
  end if;
  if p.paid_on is not null then
    raise exception 'already paid' using errcode = '22023';
  end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Riyadh')::date + 1 or p_from not in ('bank', 'cash')
     or char_length(coalesce(p_reference, '')) > 80 then
    raise exception 'invalid payment' using errcode = '22023';
  end if;
  update public.purchases set paid_on = p_date, paid_from = p_from, paid_reference = nullif(btrim(p_reference), '') where id = p.id;
end;
$$;

create or replace function public.contract_warranties(p_org uuid)
returns table (contract_id uuid, number text, client_name text, handover_at timestamptz, warranty_end date)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.number, cl.name, private.handover_at(c.id), private.warranty_end(c.id)
  from public.contracts c join public.clients cl on cl.id = c.client_id
  where c.organization_id = p_org and c.status = 'accepted' and private.has_permission(p_org, 'projects.view')
    and private.can_access_contract(p_org, c.id)
    and private.handover_at(c.id) is not null;
$$;

-- ---------------------------------------------------------------------------
-- #8 In-house labour actual cost (mirror of employeeCost() in src/lib/costing)
-- ---------------------------------------------------------------------------
-- Fully loaded monthly cost: salary + allowances + active statutory items
-- (percent of basic + housing, monthly, annual ÷ 12, one-time ÷ amortize months).
create or replace function private.employee_month_cost(p_employee uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select e.basic_salary + e.housing_allowance + e.transport_allowance + e.other_allowances
    + coalesce((select sum(case i.basis
                             when 'percent' then (e.basic_salary + e.housing_allowance) * i.value / 100
                             when 'monthly' then i.value
                             when 'annual' then i.value / 12
                             when 'one_time' then i.value / greatest(1, coalesce(i.amortize_months, 12))
                             else 0 end)
                from public.employee_cost_items i
                where i.organization_id = e.organization_id and i.is_active
                  and (i.applies_to = 'all' or (i.applies_to = 'saudi') = e.is_saudi)), 0)
  from public.employees e where e.id = p_employee
$$;

create or replace function private.employee_day_cost(p_employee uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select private.employee_month_cost(e.id)
         / coalesce((select nullif(s.working_days_per_month, 0) from public.pricing_settings s where s.organization_id = e.organization_id), 26)
  from public.employees e where e.id = p_employee
$$;

-- Working days between two dates (inclusive): Friday is the weekly rest day
-- (cost per worker-day = monthly cost ÷ 26 working days).
create or replace function private.work_days(p_from date, p_to date)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when p_to < p_from then 0
         else (select count(*)::int from generate_series(p_from, p_to, interval '1 day') g where extract(isodow from g) <> 5) end
$$;
revoke all on function private.work_days(date, date) from public;

-- In-house labour on a project between two days (inclusive): each booked work day (no Fridays)
-- of each active member of an in-house team costs that employee's day cost, shared equally
-- between the projects he is booked on that day through any in-house team (so an employee's
-- day is never charged twice, even when he is in two teams). Overlapping bookings count once.
create or replace function private.project_labour(p_contract uuid, p_from date default null, p_to date default null)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select distinct m.employee_id, g::date as d
    from public.schedule_entries s
    join public.teams t on t.id = s.team_id and t.kind = 'inhouse'
    join public.team_members m on m.team_id = t.id
    join public.employees e on e.id = m.employee_id and e.status = 'active'
    cross join lateral generate_series(greatest(s.start_date, coalesce(p_from, s.start_date)),
                                       least(s.end_date, coalesce(p_to, (now() at time zone 'Asia/Riyadh')::date)),
                                       interval '1 day') g
    where s.contract_id = p_contract and s.kind = 'work'
      and extract(isodow from g) <> 5
  )
  select coalesce(sum(
           private.employee_day_cost(x.employee_id)
           / greatest(1, (select count(distinct o.contract_id) from public.schedule_entries o
                          join public.teams ot on ot.id = o.team_id and ot.kind = 'inhouse'
                          join public.team_members om on om.team_id = o.team_id and om.employee_id = x.employee_id
                          join public.contracts oc on oc.id = o.contract_id
                          where o.kind = 'work' and x.d between o.start_date and o.end_date
                            and (oc.status <> 'cancelled' or oc.id = p_contract)))), 0)
  from days x
$$;
revoke all on function private.employee_month_cost(uuid), private.employee_day_cost(uuid),
  private.project_labour(uuid, date, date) from public;

-- Project figures used by the alerts, now with in-house labour.
drop function private.project_actuals(uuid);
create or replace function private.project_actuals(p_contract uuid)
returns table (materials numeric, subcontractors numeric, labour numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(m.quantity * m.unit_cost) from public.inventory_movements m where m.contract_id = p_contract), 0)
    + coalesce((select sum(l.amount * case when o.vat_number is not null or p.subtotal = 0 then 1 else p.total / p.subtotal end)
                from public.purchases p
                join public.purchase_lines l on l.purchase_id = p.id and l.kind = 'expense'
                join public.organizations o on o.id = p.organization_id
                where p.contract_id = p_contract and p.status = 'recorded'), 0)
    + coalesce((select sum(e.amount) from public.petty_cash_entries e where e.contract_id = p_contract and e.kind = 'expense'), 0),
    coalesce((select sum(w.amount) from public.subcontractor_work w
              join public.subcontractor_agreements g on g.id = w.agreement_id where g.contract_id = p_contract), 0),
    private.project_labour(p_contract)
$$;
revoke all on function private.project_actuals(uuid) from public;

-- Staff: in-house labour per project (totals only; costs.view + hr.view, visible projects only).
create or replace function public.project_labour_costs(p_org uuid)
returns table (contract_id uuid, labour numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- team labour is built from salaries: costs.view and hr.view
  if not (private.has_permission(p_org, 'costs.view') and private.has_permission(p_org, 'hr.view')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select c.id, round(private.project_labour(c.id), 2)
    from public.contracts c
    where c.organization_id = p_org and c.status <> 'cancelled' and private.can_access_contract(p_org, c.id)
      and exists (select 1 from public.schedule_entries s join public.teams t on t.id = s.team_id
                  where s.contract_id = c.id and s.kind = 'work' and t.kind = 'inhouse');
end;
$$;
revoke all on function public.project_labour_costs(uuid) from public, anon;
grant execute on function public.project_labour_costs(uuid) to authenticated, service_role;

-- Owner finance: this month's loaded cost of in-house team members vs what projects absorbed
-- (totals only; costs.view + finance.view + hr.view).
create or replace function public.team_cost_month(p_org uuid)
returns table (monthly numeric, allocated numeric, to_date numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_start date := date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date;
begin
  if not (private.has_permission(p_org, 'costs.view') and private.has_permission(p_org, 'finance.view')
          and private.has_permission(p_org, 'hr.view')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select
      round(coalesce((select sum(private.employee_month_cost(e.id)) from public.employees e
                      where e.organization_id = p_org and e.status = 'active'
                        and exists (select 1 from public.team_members m join public.teams t on t.id = m.team_id
                                    where m.employee_id = e.id and t.kind = 'inhouse' and t.is_active)), 0), 2),
      round(coalesce((select sum(private.project_labour(c.id, v_start, v_today)) from public.contracts c
                      where c.organization_id = p_org and c.status <> 'cancelled'), 0), 2),
      -- the same daily rate as allocated: each member's cost per worker-day × the work days gone so far,
      -- never more than the month's cost (months with 27 work days)
      round(least(
        coalesce((select sum(private.employee_day_cost(e.id)) from public.employees e
                  where e.organization_id = p_org and e.status = 'active'
                    and exists (select 1 from public.team_members m join public.teams t on t.id = m.team_id
                                where m.employee_id = e.id and t.kind = 'inhouse' and t.is_active)), 0)
          * private.work_days(v_start, v_today),
        coalesce((select sum(private.employee_month_cost(e.id)) from public.employees e
                  where e.organization_id = p_org and e.status = 'active'
                    and exists (select 1 from public.team_members m join public.teams t on t.id = m.team_id
                                where m.employee_id = e.id and t.kind = 'inhouse' and t.is_active)), 0)), 2);
end;
$$;
revoke all on function public.team_cost_month(uuid) from public, anon;
grant execute on function public.team_cost_month(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Daily reminders: addenda payments too (#1); contracts passed explicitly and
-- links to the contract / item (#6); in-house labour in the profit check (#8).
-- ---------------------------------------------------------------------------
create or replace function public.run_daily_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  t record;
  v_count int := 0;
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_act record;
  v_est_mat numeric;
  v_est_all numeric;
  v_revenue numeric;
  v_ratio numeric;
  v_bucket int;
  v_expected numeric;
  v_actual numeric;
  v_last date;
  v_gap int;
begin
  for r in
    select p.id, p.organization_id, p.contract_id, p.label, p.amount - coalesce(p.paid_amount, 0) as left_amount, c.number,
           (v_today - (p.requested_at at time zone 'Asia/Riyadh')::date) as age
    from public.contract_payments p join public.contracts c on c.id = p.contract_id
    where p.status = 'requested' and p.requested_at is not null
      and (v_today - (p.requested_at at time zone 'Asia/Riyadh')::date) in (7, 14, 30, 60, 90)
  loop
    perform private.notify(r.organization_id, 'finance.view', 'payment_late',
      jsonb_build_object('number', r.number, 'label', r.label, 'amount', r.left_amount, 'days', r.age),
      '/reports', 'late:' || r.id || ':' || r.age, r.contract_id);
    v_count := v_count + 1;
  end loop;

  -- addenda: their payment is requested when the client accepts
  for r in
    select a.id, a.organization_id, a.contract_id, a.number || ' — ' || a.title as label, a.total - coalesce(a.paid_amount, 0) as left_amount, c.number,
           (v_today - (a.accepted_at at time zone 'Asia/Riyadh')::date) as age
    from public.addenda a join public.contracts c on c.id = a.contract_id
    where a.status = 'accepted' and a.payment_status = 'requested' and a.accepted_at is not null
      and (v_today - (a.accepted_at at time zone 'Asia/Riyadh')::date) in (7, 14, 30, 60, 90)
  loop
    perform private.notify(r.organization_id, 'finance.view', 'payment_late',
      jsonb_build_object('number', r.number, 'label', r.label, 'amount', r.left_amount, 'days', r.age),
      '/reports', 'late:' || r.id || ':' || r.age, r.contract_id);
    v_count := v_count + 1;
  end loop;

  for r in
    select e.organization_id, e.id, e.full_name, d.kind, d.expiry, (d.expiry - v_today) as days
    from public.employees e
    cross join lateral (values ('id', e.id_expiry), ('passport', e.passport_expiry), ('insurance', e.insurance_expiry)) as d(kind, expiry)
    where e.status <> 'final_exit' and d.expiry is not null and (d.expiry - v_today) in (60, 30, 7, 0)
  loop
    perform private.notify(r.organization_id, 'hr.view', 'doc_expiry',
      jsonb_build_object('name', r.full_name, 'doc', r.kind, 'days', r.days, 'date', r.expiry), '/team/payroll', 'doc:' || r.id || ':' || r.kind || ':' || r.days);
    v_count := v_count + 1;
  end loop;

  for r in
    select a.id, a.organization_id, a.kind, a.entity, a.entity_id, a.details ->> 'number' as number
    from public.approvals a
    where a.status = 'pending' and a.created_at < now() - interval '1 day'
  loop
    select * into t from private.approval_target(r.entity, r.entity_id);
    perform private.notify(r.organization_id, 'approvals.decide', 'approval_reminder',
      jsonb_build_object('approval_id', r.id, 'kind', r.kind, 'number', r.number), t.link, 'remind:' || r.id || ':' || v_today, t.contract_id);
    v_count := v_count + 1;
  end loop;

  -- Projects under way: accepted, not handed over.
  for r in
    select c.id, c.organization_id, c.number, c.total, c.start_date, c.duration_days, c.quote_id, c.quote_version, c.accepted_at,
           cl.name as client,
           c.start_date + c.duration_days + coalesce((select sum(a.extra_days) from public.addenda a where a.contract_id = c.id and a.status = 'accepted'), 0)::int as due
    from public.contracts c
    join public.clients cl on cl.id = c.client_id
    where c.status = 'accepted'
      and not exists (select 1 from public.project_stages s where s.contract_id = c.id and s.is_final and s.status = 'confirmed')
  loop
    -- delay
    if v_today - r.due in (1, 7, 14, 30, 60) then
      perform private.notify(r.organization_id, 'projects.view', 'project_delay',
        jsonb_build_object('number', r.number, 'client', r.client, 'days', v_today - r.due, 'due', r.due),
        '/projects/' || r.number, 'delay:' || r.id || ':' || (v_today - r.due), r.id);
      v_count := v_count + 1;
    end if;

    -- missed visits (work started)
    if r.start_date <= v_today then
      select max((v.checked_in_at at time zone 'Asia/Riyadh')::date) into v_last from public.site_visits v where v.contract_id = r.id;
      v_last := greatest(coalesce(v_last, r.start_date), r.start_date);
      v_gap := v_today - v_last;
      if v_gap in (3, 7, 14) then
        perform private.notify(r.organization_id, 'projects.manage', 'missed_visit',
          jsonb_build_object('number', r.number, 'client', r.client, 'days', v_gap),
          '/projects/' || r.number, 'visit:' || r.id || ':' || v_last || ':' || v_gap, r.id);
        v_count := v_count + 1;
      end if;
    end if;

    -- costs (costs.view only)
    select coalesce(sum((l ->> 'cost')::numeric) filter (where l ->> 'group' = 'material'), 0), coalesce(sum((l ->> 'cost')::numeric), 0)
    into v_est_mat, v_est_all
    from public.quote_versions qv
    join public.quote_version_costs qc on qc.quote_version_id = qv.id
    cross join lateral jsonb_array_elements(qc.lines) l
    where qv.quote_id = r.quote_id and qv.version = r.quote_version;
    select * into v_act from private.project_actuals(r.id);

    if v_est_mat > 0 and v_act.materials > v_est_mat then
      v_ratio := v_act.materials / v_est_mat;
      v_bucket := case when v_ratio >= 1.5 then 150 when v_ratio >= 1.25 then 125 when v_ratio >= 1.1 then 110 else 100 end;
      perform private.notify(r.organization_id, 'costs.view', 'project_over_budget',
        jsonb_build_object('number', r.number, 'client', r.client, 'percent', round((v_ratio - 1) * 100), 'actual', round(v_act.materials, 2), 'estimated', round(v_est_mat, 2)),
        '/purchases/costs', 'budget:' || r.id || ':' || v_bucket, r.id);
      v_count := v_count + 1;
    end if;

    select r.total - coalesce((qv.client_view ->> 'vat')::numeric, 0) into v_revenue
    from public.quote_versions qv where qv.quote_id = r.quote_id and qv.version = r.quote_version;
    v_revenue := coalesce(v_revenue, r.total)
      + coalesce((select sum(a.amount) from public.addenda a where a.contract_id = r.id and a.status = 'accepted'), 0);
    v_actual := v_revenue - (v_act.materials + v_act.subcontractors + v_act.labour);
    v_expected := case when v_est_all > 0 then v_revenue - v_est_all end;
    -- the profit includes in-house labour (built from salaries): costs.view and hr.view
    if (v_act.materials + v_act.subcontractors + v_act.labour) > 0 and (v_actual < 0 or (v_expected is not null and v_expected > 0 and v_actual < v_expected * 0.5)) then
      perform private.notify(r.organization_id, 'costs.view', 'project_losing',
        jsonb_build_object('number', r.number, 'client', r.client, 'profit', round(v_actual, 2), 'expected', round(v_expected, 2)),
        '/purchases/costs', 'losing:' || r.id || ':' || case when v_actual < 0 then 'loss' else 'low' end, r.id, 'hr.view');
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.run_daily_reminders() from public, anon, authenticated;
grant execute on function public.run_daily_reminders() to service_role;

-- ---------------------------------------------------------------------------
-- Private helpers callable by signed-in users answer only about their own
-- organizations (tests/db/invariants.test.ts keeps the reviewed list).
-- ---------------------------------------------------------------------------
-- average cost is only needed inside move_stock (definer)
revoke all on function private.average_cost(uuid, uuid) from public, authenticated;

-- someone's permissions: only yourself, a fellow member, or the database itself (no signed-in user)
create or replace function private.member_permissions(p_org uuid, p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when m.role = 'owner' then private.all_permissions()
      else array(
        select p from unnest(
          private.role_permissions(m.role)
          || array(select jsonb_array_elements_text(coalesce(m.permission_overrides -> 'grant', '[]')))
        ) as p
        where p = any (private.all_permissions())
        except
        select jsonb_array_elements_text(coalesce(m.permission_overrides -> 'deny', '[]'))
      )
    end
    from public.memberships m
    where m.organization_id = p_org and m.user_id = p_user and m.status = 'active'
      and (auth.uid() is null or p_user = auth.uid() or private.is_member(p_org))
  ), array[]::text[])
$$;

-- ---------------------------------------------------------------------------
-- Quote versions are written only by the server. A user with quotes.manage could
-- otherwise insert a version (and its costs) with any total / margin and issue it
-- without the owner. saveQuoteVersion recomputes the price on the server and saves it
-- through public.save_quote_version (service role only), which checks the user.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.quote_versions, public.quote_version_costs from authenticated;
drop policy if exists quote_versions_insert on public.quote_versions;
drop policy if exists quote_version_costs_insert on public.quote_version_costs;

create or replace function public.save_quote_version(p_user uuid, p_quote uuid, p_payload jsonb)
returns table (id uuid, version int)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  q public.quotes;
  v jsonb := p_payload -> 'version';
  c jsonb := p_payload -> 'costs';
  v_id uuid;
  v_version int;
begin
  select * into q from public.quotes x where x.id = p_quote;
  if q.id is null or p_user is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- act as the user for the rest of this transaction: auth.uid() → permissions (incl. delegations),
  -- created_by and the audit log all see who saved the version
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  if not private.has_permission(q.organization_id, 'quotes.manage')
     or (c is not null and jsonb_typeof(c) = 'object' and not private.has_permission(q.organization_id, 'costs.view')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v is null or jsonb_typeof(v) <> 'object' then
    raise exception 'invalid version' using errcode = '22023';
  end if;
  insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, pricing_method, estimated,
                                     discount, subtotal, vat_percent, vat, total, notes, problems, created_by)
  values (q.organization_id, q.id, 1, v -> 'selection', v -> 'quantities', v -> 'client_view', coalesce(v ->> 'pricing_method', 'unit'),
          coalesce((v ->> 'estimated')::boolean, false), coalesce((v ->> 'discount')::numeric, 0), (v ->> 'subtotal')::numeric,
          coalesce((v ->> 'vat_percent')::numeric, 0), coalesce((v ->> 'vat')::numeric, 0), (v ->> 'total')::numeric, v ->> 'notes',
          coalesce((v ->> 'problems')::int, 0), p_user)
  returning quote_versions.id, quote_versions.version into v_id, v_version;
  if c is not null and jsonb_typeof(c) = 'object' then
    insert into public.quote_version_costs (quote_version_id, organization_id, cost, cost_with_contingency, margin_percent, lines, purchase_list, created_by)
    values (v_id, q.organization_id, (c ->> 'cost')::numeric, (c ->> 'cost_with_contingency')::numeric, (c ->> 'margin_percent')::numeric,
            c -> 'lines', coalesce(c -> 'purchase_list', '[]'::jsonb), p_user);
  end if;
  return query select v_id, v_version;
end;
$$;
revoke all on function public.save_quote_version(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_quote_version(uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Rows from before amounts were recorded, and approvals from before they carried
-- their contract. Idempotent; run once here (the triggers issue the receipts,
-- invoice paid state, client page and Qoyod jobs).
-- ---------------------------------------------------------------------------
create or replace function private.review_backfill()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.addenda a
  set paid_amount = a.total, paid_at = coalesce(a.paid_at, (a.accepted_at at time zone 'Asia/Riyadh')::date, (a.updated_at at time zone 'Asia/Riyadh')::date)
  where a.payment_status = 'paid' and a.paid_amount is null;

  update public.approvals ap
  set details = ap.details || jsonb_build_object('contract', c.number)
  from public.addenda ad join public.contracts c on c.id = ad.contract_id
  where ap.entity = 'addendum' and ap.entity_id = ad.id and not (ap.details ? 'contract');
end;
$$;
revoke all on function private.review_backfill() from public;
select private.review_backfill();

-- The client page: a payment marked paid is paid in full (also rows from before amounts were recorded).
create or replace function public.portal_invoice_docs(p_number text, p_token text)
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
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'kind', i.kind, 'issue_date', i.issue_date, 'due_date', i.due_date,
      'description', i.description, 'seller', i.seller, 'buyer', i.buyer, 'subtotal', i.subtotal, 'vat_percent', i.vat_percent, 'vat', i.vat,
      'total', i.total, 'created_at', i.created_at,
      'paid', case when p.status = 'paid' or a.payment_status = 'paid' then greatest(i.total, coalesce(p.paid_amount, a.paid_amount, 0))
                   else coalesce(p.paid_amount, a.paid_amount, 0) end,
      'official', case when i.payment_id is not null then 'p' || p.seq else a.number end,
      'has_official', exists (select 1 from public.qoyod_sync_jobs j where j.entity_id = coalesce(i.payment_id, i.addendum_id) and j.kind = 'invoice' and j.status = 'done' and j.qoyod_id is not null))
      order by i.issue_date, i.number)
    from public.invoices i
    left join public.contract_payments p on p.id = i.payment_id
    left join public.addenda a on a.id = i.addendum_id
    where i.contract_id = v_link.contract_id), '[]'::jsonb);
end;
$$;
revoke all on function public.portal_invoice_docs(text, text) from public, anon, authenticated;
grant execute on function public.portal_invoice_docs(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Qoyod: the owner approved the draft invoices in Qoyod (or switched sending to
-- "Approved") → the waiting jobs are sent now instead of in up to 12 hours.
-- ---------------------------------------------------------------------------
create or replace function public.qoyod_wake_waiting(p_org uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if not (private.has_permission(p_org, 'finance.manage') or private.has_permission(p_org, 'settings.manage')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.qoyod_sync_jobs set next_attempt_at = now()
  where organization_id = p_org and status = 'queued' and last_error like 'waiting:%';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.qoyod_wake_waiting(uuid) from public, anon;
grant execute on function public.qoyod_wake_waiting(uuid) to authenticated, service_role;
