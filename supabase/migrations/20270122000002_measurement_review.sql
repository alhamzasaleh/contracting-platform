-- Review of the measurement sheets (Nov 2026): credit notes for amounts already invoiced, the client sees
-- only what was sent to him, finance is told about money owed back, subcontractor agreements flagged,
-- reminders, profit alerts count the settlement.

-- 1) credit notes (إشعار دائن, CN-): made only by the database when a signed measurement takes money off
-- an invoiced payment (its unpaid part) or leaves an amount owed back to the client. Linked to the invoice
-- it reduces; tax kind / VAT % follow that invoice. Sent to Qoyod as a credit note (and allocated to the
-- invoice when it reduced an unpaid payment).
create or replace function private.document_prefix(p_doc_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_doc_type
    when 'client' then 'CL'
    when 'request' then 'R'
    when 'survey' then 'SV'
    when 'quote' then 'Q'
    when 'contract' then 'C'
    when 'project' then 'P'
    when 'purchase' then 'PO'
    when 'invoice' then 'INV'
    when 'addendum' then 'AD'
    when 'maintenance' then 'MR'
    when 'receipt' then 'RV'
    when 'marketer' then 'MK'
    when 'payment_voucher' then 'PV'
    when 'measurement' then 'MS'
    when 'credit_note' then 'CN'
  end
$$;

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text,
  contract_id uuid not null references public.contracts (id) on delete restrict,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  measurement_id uuid references public.contract_measurements (id) on delete restrict,
  -- the payment whose unpaid part it took off (null = an amount owed back to the client)
  payment_id uuid references public.contract_payments (id) on delete restrict,
  kind text not null check (kind in ('tax', 'simple')),
  issue_date date not null,
  description text not null check (char_length(description) between 1 and 300),
  seller jsonb not null check (jsonb_typeof(seller) = 'object'),
  buyer jsonb not null check (jsonb_typeof(buyer) = 'object'),
  subtotal numeric(14, 2) not null check (subtotal >= 0),
  vat_percent numeric(5, 2) not null default 0 check (vat_percent between 0 and 100),
  vat numeric(14, 2) not null default 0 check (vat >= 0),
  total numeric(14, 2) not null check (total > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (organization_id, number),
  check (abs(subtotal + vat - total) <= 0.02)
);
create index credit_notes_contract_idx on public.credit_notes (contract_id);
create index credit_notes_invoice_idx on public.credit_notes (invoice_id);
create trigger credit_notes_number before insert on public.credit_notes
  for each row execute function private.assign_document_number('credit_note');
create trigger credit_notes_created_by before insert on public.credit_notes
  for each row execute function private.set_created_by();
select private.enable_audit('public.credit_notes');
alter table public.credit_notes enable row level security;
-- money documents: finance.view (like invoices and receipt vouchers); nobody writes them
create policy credit_notes_select on public.credit_notes for select to authenticated
  using ((select private.has_permission(organization_id, 'finance.view')));
create policy credit_notes_project_scope on public.credit_notes as restrictive for all to authenticated
  using (private.can_access_contract(organization_id, contract_id))
  with check (private.can_access_contract(organization_id, contract_id));
revoke all on public.credit_notes from anon, authenticated;
grant select on public.credit_notes to authenticated;
grant all on public.credit_notes to service_role;

-- Qoyod: credit notes, and their allocation to the invoice they reduce (waits for Approved like payments)
alter table public.qoyod_sync_jobs drop constraint qoyod_sync_jobs_kind_check;
alter table public.qoyod_sync_jobs add constraint qoyod_sync_jobs_kind_check check (kind in (
  'customer', 'vendor', 'invoice', 'invoice_payment', 'bill', 'bill_payment', 'payroll', 'transfer', 'credit_note', 'credit_allocation'));
alter table public.qoyod_sync_jobs drop constraint qoyod_sync_jobs_entity_type_check;
alter table public.qoyod_sync_jobs add constraint qoyod_sync_jobs_entity_type_check check (entity_type in (
  'client', 'supplier', 'subcontractor', 'contract_payment', 'addendum', 'purchase', 'payroll_run', 'subcontractor_payment',
  'petty_cash', 'petty_cash_opening', 'marketer', 'commission_payment', 'credit_note'));

create or replace function public.qoyod_claim_jobs(p_limit integer)
returns setof public.qoyod_sync_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.qoyod_sync_jobs set status = 'queued'
  where status = 'running' and updated_at < now() - interval '10 minutes';
  return query
  with claimed as (
  update public.qoyod_sync_jobs j set status = 'running', attempts = j.attempts + 1
  where j.id in (
    select q.id from public.qoyod_sync_jobs q
    join public.qoyod_settings s on s.organization_id = q.organization_id and s.enabled
    where q.status = 'queued' and q.next_attempt_at <= now()
      and (s.invoice_status = 'Approved' or q.kind not in ('invoice_payment', 'bill_payment', 'payroll', 'transfer', 'credit_allocation'))
    order by case q.kind when 'customer' then 0 when 'vendor' then 0 when 'invoice' then 1 when 'bill' then 1 when 'credit_note' then 2 else 3 end, q.created_at
    limit least(greatest(p_limit, 1), 50)
    for update of q skip locked)
  returning j.*)
  select * from claimed c
  order by case c.kind when 'customer' then 0 when 'vendor' then 0 when 'invoice' then 1 when 'bill' then 1 when 'credit_note' then 2 else 3 end, c.created_at;
end;
$$;

create or replace function private.issue_credit_note(p_measurement uuid, p_invoice uuid, p_payment uuid, p_gross numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.invoices;
  m public.contract_measurements;
  v_net numeric;
  v_id uuid;
begin
  if p_gross is null or p_gross <= 0 then
    return null;
  end if;
  select * into i from public.invoices where id = p_invoice;
  if i.id is null then
    return null;
  end if;
  select * into m from public.contract_measurements where id = p_measurement;
  v_net := round(p_gross / (1 + i.vat_percent / 100), 2);
  insert into public.credit_notes (organization_id, contract_id, invoice_id, measurement_id, payment_id, kind, issue_date, description,
                                   seller, buyer, subtotal, vat_percent, vat, total)
  values (i.organization_id, i.contract_id, i.id, p_measurement, p_payment, i.kind, (now() at time zone 'Asia/Riyadh')::date,
          left(coalesce(m.number || ' — ', '') || 'تسوية الأمتار', 300), i.seller, i.buyer,
          v_net, i.vat_percent, round(p_gross - v_net, 2), round(p_gross, 2))
  returning id into v_id;
  perform private.qoyod_enqueue(i.organization_id, 'credit_note', 'credit_note', v_id, 'cn:' || v_id);
  if p_payment is not null then
    perform private.qoyod_enqueue(i.organization_id, 'credit_allocation', 'credit_note', v_id, 'cna:' || v_id, round(p_gross, 2));
  end if;
  return v_id;
end;
$$;
revoke all on function private.issue_credit_note(uuid, uuid, uuid, numeric) from public;

-- 2) the client sees the sheet as it was sent (staff may correct an objected sheet before sending it again)
alter table public.contract_measurements add column sent_snapshot jsonb;

create or replace function public.send_measurement(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.contract_measurements;
begin
  select * into m from public.contract_measurements where id = p_id for update;
  if m.id is null or not private.has_permission(m.organization_id, 'projects.manage')
     or not private.can_access_contract(m.organization_id, m.contract_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if m.status not in ('draft', 'objected') then
    raise exception 'already sent' using errcode = '22023';
  end if;
  if jsonb_array_length(m.lines) = 0 then
    raise exception 'empty measurement' using errcode = '22023';
  end if;
  if not exists (select 1 from public.contracts c where c.id = m.contract_id and c.status = 'accepted') then
    raise exception 'the contract isn''t accepted' using errcode = '22023';
  end if;
  update public.contract_measurements
  set status = 'sent', sent_at = now(), sent_by = auth.uid(),
      client_decided_at = null, client_name = null, client_note = null, client_ip = null, client_user_agent = null, client_signature = null,
      sent_snapshot = jsonb_build_object('lines', m.lines, 'notes', m.notes, 'photos', to_jsonb(m.photos),
                                         'diff_subtotal', m.diff_subtotal, 'diff_vat', m.diff_vat, 'diff_total', m.diff_total)
  where id = m.id;
end;
$$;

-- users never write the snapshot
create or replace function private.guard_measurement_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and new.sent_snapshot is distinct from (case when tg_op = 'UPDATE' then old.sent_snapshot end) then
    raise exception 'measurements are sent and answered through their functions' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_measurement_snapshot() from public;
create trigger contract_measurements_guard_snapshot before insert or update on public.contract_measurements
  for each row execute function private.guard_measurement_snapshot();

create or replace function public.portal_measurements(p_number text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
begin
  if not private.portal_token_ok(p_token) or p_number is null or char_length(p_number) > 30 then
    return null;
  end if;
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null or v_link.contract_id is null then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'number', m.number, 'status', m.status,
      -- what was sent to the client (a correction after his comment shows once it is sent again)
      'lines', coalesce(m.sent_snapshot -> 'lines', m.lines), 'notes', coalesce(m.sent_snapshot ->> 'notes', m.notes),
      'photos', coalesce(m.sent_snapshot -> 'photos', to_jsonb(m.photos)),
      'diff_subtotal', coalesce((m.sent_snapshot ->> 'diff_subtotal')::numeric, m.diff_subtotal),
      'diff_vat', coalesce((m.sent_snapshot ->> 'diff_vat')::numeric, m.diff_vat),
      'diff_total', coalesce((m.sent_snapshot ->> 'diff_total')::numeric, m.diff_total),
      'sent_at', m.sent_at, 'client_decided_at', m.client_decided_at, 'client_name', m.client_name, 'client_note', m.client_note,
      'client_signature', case when m.status = 'approved' then m.client_signature end,
      'credit_amount', m.credit_amount, 'refunded_at', m.refunded_at) order by m.sent_at)
    from public.contract_measurements m
    where m.contract_id = v_link.contract_id and m.status in ('sent', 'approved', 'objected')), '[]'::jsonb);
end;
$$;

-- 3) subcontractor agreements priced per m² are flagged for review when the client signs a sheet
alter table public.subcontractor_agreements add column review_measurement_id uuid references public.contract_measurements (id) on delete set null;

create or replace function private.guard_agreement_review()
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
    if new.review_addendum_id is not null or new.review_measurement_id is not null then
      raise exception 'the review flag is set by the database' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.review_addendum_id is not null and new.review_addendum_id is distinct from old.review_addendum_id)
     or (new.review_measurement_id is not null and new.review_measurement_id is distinct from old.review_measurement_id) then
    raise exception 'the review flag is set by the database' using errcode = '42501';
  end if;
  new.review_addendum_id := null;
  new.review_measurement_id := null;
  return new;
end;
$$;

-- 4) settlement (replaces the first version): an increase never uses up an amount owed to the client
-- (that one has its credit note — finance pays it back or nets it); a decrease takes off pending payments,
-- then the unpaid part of requested ones (credit note on their invoice), the rest is owed to the client
-- (credit note on the contract's latest invoice).
create or replace function private.apply_measurement(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.contract_measurements;
  r record;
  v_left numeric;
  v_take numeric;
  v_applied jsonb := '[]'::jsonb;
  v_row public.contract_payments;
  v_handed boolean;
  v_seq int;
  v_credit numeric;
  v_count int;
  v_number text;
begin
  select * into m from public.contract_measurements where id = p_id for update;
  perform 1 from public.contracts where id = m.contract_id for update;
  v_left := m.diff_total;
  if v_left > 0 then
    for r in select id, measure_adjust from public.contract_payments
             where contract_id = m.contract_id and kind = 'schedule' and status = 'pending' and measure_adjust < 0
             order by seq for update loop
      exit when v_left <= 0;
      v_take := least(v_left, -r.measure_adjust);
      update public.contract_payments set amount = amount + v_take, measure_adjust = measure_adjust + v_take where id = r.id;
      v_applied := v_applied || jsonb_build_object('kind', 'restored', 'payment', r.id, 'amount', v_take);
      v_left := v_left - v_take;
    end loop;
    if v_left > 0 then
      select * into v_row from public.contract_payments
      where contract_id = m.contract_id and kind = 'measurement' and status = 'pending' order by seq desc limit 1 for update;
      if v_row.id is not null then
        update public.contract_payments set amount = amount + v_left where id = v_row.id;
      else
        select coalesce(max(seq), 0) + 1 into v_seq from public.contract_payments where contract_id = m.contract_id;
        insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event, kind)
        values (m.organization_id, m.contract_id, v_seq, 'تسوية الأمتار', 0, v_left, 'handover', 'measurement')
        returning * into v_row;
        select exists (select 1 from public.project_stages s where s.contract_id = m.contract_id and s.is_final and s.status = 'confirmed')
        into v_handed;
        if v_handed then
          update public.contract_payments set status = 'requested' where id = v_row.id;
        end if;
      end if;
      v_applied := v_applied || jsonb_build_object('kind', 'settlement', 'payment', v_row.id, 'amount', v_left);
    end if;
  elsif v_left < 0 then
    v_left := -v_left;
    -- a) a settlement payment still pending
    for r in select id, amount from public.contract_payments
             where contract_id = m.contract_id and kind = 'measurement' and status = 'pending'
             order by seq desc for update loop
      exit when v_left <= 0;
      v_take := least(v_left, r.amount);
      if v_take >= r.amount then
        delete from public.contract_payments where id = r.id;
      else
        update public.contract_payments set amount = amount - v_take where id = r.id;
      end if;
      v_applied := v_applied || jsonb_build_object('kind', 'settlement_reduced', 'payment', r.id, 'amount', v_take);
      v_left := v_left - v_take;
    end loop;
    -- b) the last payments still pending (no invoice yet; the final payment first)
    for r in select id, amount from public.contract_payments
             where contract_id = m.contract_id and kind = 'schedule' and status = 'pending' and amount > 0
             order by seq desc for update loop
      exit when v_left <= 0;
      v_take := least(v_left, r.amount);
      update public.contract_payments set amount = amount - v_take, measure_adjust = measure_adjust - v_take where id = r.id;
      v_applied := v_applied || jsonb_build_object('kind', 'reduced', 'payment', r.id, 'amount', v_take);
      v_left := v_left - v_take;
    end loop;
    -- c) requested and not fully paid: its unpaid part, with a credit note on its invoice
    for r in select p.id, p.amount, coalesce(p.paid_amount, 0) as paid, i.id as invoice_id
             from public.contract_payments p join public.invoices i on i.payment_id = p.id
             where p.contract_id = m.contract_id and p.status = 'requested' and p.amount - coalesce(p.paid_amount, 0) > 0.005
             order by p.seq desc for update of p loop
      exit when v_left <= 0;
      v_take := least(v_left, r.amount - r.paid);
      update public.contract_payments
      set amount = amount - v_take, measure_adjust = measure_adjust - v_take
      where id = r.id;
      -- nothing left to pay on it: settled (no receipt — nothing was received)
      if r.amount - v_take <= r.paid + 0.005 then
        update public.contract_payments set status = 'paid', paid_amount = r.paid, paid_at = coalesce(paid_at, (now() at time zone 'Asia/Riyadh')::date)
        where id = r.id;
      end if;
      perform private.issue_credit_note(m.id, r.invoice_id, r.id, v_take);
      v_applied := v_applied || jsonb_build_object('kind', 'credited', 'payment', r.id, 'amount', v_take);
      v_left := v_left - v_take;
    end loop;
    -- d) everything paid: owed back to the client, with credit notes on the contract's paid payment invoices
    -- (newest first, each at most what is still on that invoice — never on an addendum's invoice)
    if v_left > 0 then
      v_credit := v_left;
      for r in select i.id, i.total - coalesce((select sum(n.total) from public.credit_notes n where n.invoice_id = i.id), 0) as room
               from public.invoices i join public.contract_payments p on p.id = i.payment_id
               where i.contract_id = m.contract_id and p.status = 'paid'
               order by i.issue_date desc, i.number desc loop
        exit when v_credit <= 0;
        continue when r.room <= 0.005;
        v_take := least(v_credit, r.room);
        perform private.issue_credit_note(m.id, r.id, null, v_take);
        v_credit := v_credit - v_take;
      end loop;
      v_applied := v_applied || jsonb_build_object('kind', 'credit', 'amount', v_left);
    end if;
  end if;
  update public.contract_measurements set applied = v_applied, credit_amount = case when m.diff_total < 0 then greatest(v_left, 0) else 0 end
  where id = m.id;

  select number into v_number from public.contracts where id = m.contract_id;
  -- finance is told about money owed back to the client
  if m.diff_total < 0 and v_left > 0 then
    perform private.notify(m.organization_id, 'finance.manage', 'measurement_credit',
      jsonb_build_object('number', v_number, 'measurement', m.number, 'amount', v_left),
      '/contracts/' || v_number, 'measurement_credit:' || m.id, m.contract_id);
  end if;
  -- subcontractors priced per m² on this project: review the quantity
  if m.diff_total <> 0 or exists (select 1 from jsonb_array_elements(m.lines) l where (l ->> 'diff_area')::numeric <> 0) then
    update public.subcontractor_agreements set review_measurement_id = m.id
    where contract_id = m.contract_id and status = 'active' and basis = 'per_m2';
    get diagnostics v_count = row_count;
    if v_count > 0 then
      perform private.notify(m.organization_id, 'purchases.manage', 'agreement_review',
        jsonb_build_object('number', v_number, 'addendum', m.number, 'count', v_count), '/purchases/subcontractors', 'agreement_review:' || m.id, m.contract_id);
      perform private.notify(m.organization_id, 'finance.manage', 'agreement_review',
        jsonb_build_object('number', v_number, 'addendum', m.number, 'count', v_count), '/purchases/subcontractors', 'agreement_review:' || m.id, m.contract_id);
    end if;
  end if;
end;
$$;
revoke all on function private.apply_measurement(uuid) from public;

-- 5) the basis says whether the contract has accepted additional works (the dialog warns: don't measure them twice)
create or replace function private.contract_measure_basis(p_contract uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'method', coalesce(qv.client_view ->> 'method', 'unit'),
    'work_types', coalesce(qv.client_view -> 'workTypes', '[]'::jsonb),
    'discount_percent', coalesce((qv.client_view ->> 'discountPercent')::numeric,
      case when coalesce((qv.client_view ->> 'subtotal')::numeric, 0) > 0
           then coalesce((qv.client_view ->> 'discount')::numeric, 0) / (qv.client_view ->> 'subtotal')::numeric * 100 else 0 end),
    'vat_percent', coalesce((qv.client_view ->> 'vatPercent')::numeric, qv.vat_percent, 0),
    'addenda', (select count(*) from public.addenda a where a.contract_id = c.id and a.status = 'accepted'))
  from public.contracts c
  join public.quote_versions qv on qv.quote_id = c.quote_id and qv.version = c.quote_version
  where c.id = p_contract
$$;

-- 6) notifications
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted', 'payment_received', 'payment_late',
  'doc_expiry', 'approval_reminder', 'maintenance_request', 'project_delay', 'project_over_budget', 'project_losing', 'missed_visit',
  'agreement_review', 'quote_accepted', 'quote_changes_requested', 'quote_rejected', 'commission_due',
  'measurement_approved', 'measurement_objected', 'measurement_waiting', 'measurement_credit'));
alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check check (kind in (
  'approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted', 'payment_received', 'payment_late',
  'doc_expiry', 'approval_reminder', 'maintenance_request', 'project_delay', 'project_over_budget', 'project_losing', 'missed_visit',
  'agreement_review', 'quote_accepted', 'quote_changes_requested', 'quote_rejected', 'commission_due',
  'measurement_approved', 'measurement_objected', 'measurement_waiting', 'measurement_credit'));

-- 7) daily reminders: the settlement counts in the profit alert; sheets waiting for the client
create or replace function public.run_daily_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  t record;
  v_count int := 0;
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_act record;
  v_est_mat numeric;
  v_est_all numeric;
  v_add_mat numeric;
  v_add_all numeric;
  v_revenue numeric;
  v_ratio numeric;
  v_bucket int;
  v_expected numeric;
  v_actual numeric;
  v_cost numeric;
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

  -- Projects under way (accepted, not handed over) + handed over, still in warranty (profit only).
  for r in
    select x.* from (
      select c.id, c.organization_id, c.number, c.total, c.start_date, c.duration_days, c.quote_id, c.quote_version, c.accepted_at,
             cl.name as client,
             c.start_date + c.duration_days + coalesce((select sum(a.extra_days) from public.addenda a where a.contract_id = c.id and a.status = 'accepted'), 0)::int as due,
             exists (select 1 from public.project_stages s where s.contract_id = c.id and s.is_final and s.status = 'confirmed') as handed
      from public.contracts c
      join public.clients cl on cl.id = c.client_id
      where c.status = 'accepted'
    ) x
    where not x.handed or private.warranty_end(x.id) >= v_today
  loop
    -- delay
    if not r.handed and v_today - r.due in (1, 7, 14, 30, 60) then
      perform private.notify(r.organization_id, 'projects.view', 'project_delay',
        jsonb_build_object('number', r.number, 'client', r.client, 'days', v_today - r.due, 'due', r.due),
        '/projects/' || r.number, 'delay:' || r.id || ':' || (v_today - r.due), r.id);
      v_count := v_count + 1;
    end if;

    -- missed visits (work started)
    if not r.handed and r.start_date <= v_today then
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

    -- costs (costs.view only): the quote's estimate + accepted addenda estimates
    select coalesce(sum((l ->> 'cost')::numeric) filter (where l ->> 'group' = 'material'), 0), coalesce(sum((l ->> 'cost')::numeric), 0)
    into v_est_mat, v_est_all
    from public.quote_versions qv
    join public.quote_version_costs qc on qc.quote_version_id = qv.id
    cross join lateral jsonb_array_elements(qc.lines) l
    where qv.quote_id = r.quote_id and qv.version = r.quote_version;
    select coalesce(sum(k.material_cost), 0), coalesce(sum(k.material_cost + k.other_cost), 0) into v_add_mat, v_add_all
    from public.addendum_costs k join public.addenda a on a.id = k.addendum_id
    where a.contract_id = r.id and a.status = 'accepted';
    v_est_mat := v_est_mat + v_add_mat;
    v_est_all := v_est_all + v_add_all;
    -- the marketer's commission is part of the expected cost (the price carries it); paid → actual
    v_est_all := v_est_all + coalesce((select k.amount from public.marketer_commissions k where k.contract_id = r.id and k.status <> 'cancelled'), 0);
    select * into v_act from private.project_actuals(r.id);

    if not r.handed and v_est_mat > 0 and v_act.materials > v_est_mat then
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
      + coalesce((select sum(a.amount) from public.addenda a where a.contract_id = r.id and a.status = 'accepted'), 0)
      -- the quantity settlement the client signed (measurement sheets), before VAT — same as the app's profit
      + coalesce((select sum(m.diff_subtotal) from public.contract_measurements m where m.contract_id = r.id and m.status = 'approved'), 0);
    v_cost := v_act.materials + v_act.subcontractors + v_act.labour + v_act.maintenance + v_act.commission;
    v_actual := v_revenue - v_cost;
    v_expected := case when v_est_all > 0 then v_revenue - v_est_all end;
    -- the profit includes in-house labour (built from salaries): costs.view and hr.view
    if v_cost > 0 and (v_actual < 0 or (v_expected is not null and v_expected > 0 and v_actual < v_expected * 0.5)) then
      perform private.notify(r.organization_id, 'costs.view', 'project_losing',
        jsonb_build_object('number', r.number, 'client', r.client, 'profit', round(v_actual, 2), 'expected', round(v_expected, 2)),
        '/purchases/costs', 'losing:' || r.id || ':' || case when v_actual < 0 then 'loss' else 'low' end, r.id, 'hr.view');
      v_count := v_count + 1;
    end if;
  end loop;

  -- success partners' rewards due and still unpaid after 7 / 14 / 30 days (finance.manage)
  for r in
    select k.id, k.organization_id, k.contract_id, k.amount, c.number, m.name as marketer,
           (v_today - (k.due_at at time zone 'Asia/Riyadh')::date) as age
    from public.marketer_commissions k
    join public.contracts c on c.id = k.contract_id
    join public.marketers m on m.id = k.marketer_id
    where k.status = 'due' and k.due_at is not null
      and (v_today - (k.due_at at time zone 'Asia/Riyadh')::date) in (7, 14, 30)
  loop
    perform private.notify(r.organization_id, 'finance.manage', 'commission_due',
      jsonb_build_object('number', r.number, 'marketer', r.marketer, 'amount', r.amount, 'days', r.age),
      '/partners?k=' || r.id, 'commission_due:' || r.id || ':' || r.age, r.contract_id);
    v_count := v_count + 1;
  end loop;

  -- measurement sheets waiting for the client's answer 3 / 7 / 14 days (they hold the final handover)
  for r in
    select m.id, m.organization_id, m.contract_id, m.number as measurement, c.number,
           (v_today - (m.sent_at at time zone 'Asia/Riyadh')::date) as age
    from public.contract_measurements m join public.contracts c on c.id = m.contract_id
    where m.status = 'sent' and m.sent_at is not null and c.status = 'accepted'
      and (v_today - (m.sent_at at time zone 'Asia/Riyadh')::date) in (3, 7, 14)
  loop
    perform private.notify(r.organization_id, 'projects.manage', 'measurement_waiting',
      jsonb_build_object('number', r.number, 'measurement', r.measurement, 'days', r.age),
      '/projects/' || r.number || '?m=' || r.measurement, 'measurement_waiting:' || r.id || ':' || r.age, r.contract_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

-- 8) the client page lists his credit notes (service role, same token checks as the page)
create or replace function public.portal_credit_notes(p_number text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
begin
  if not private.portal_token_ok(p_token) or p_number is null or char_length(p_number) > 30 then
    return null;
  end if;
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null or v_link.contract_id is null then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'number', n.number, 'kind', n.kind, 'issue_date', n.issue_date, 'description', n.description, 'seller', n.seller, 'buyer', n.buyer,
      'subtotal', n.subtotal, 'vat_percent', n.vat_percent, 'vat', n.vat, 'total', n.total, 'created_at', n.created_at,
      'invoice', (select i.number from public.invoices i where i.id = n.invoice_id)) order by n.created_at)
    from public.credit_notes n where n.contract_id = v_link.contract_id), '[]'::jsonb);
end;
$$;
revoke all on function public.portal_credit_notes(text, text) from public, anon, authenticated;
grant execute on function public.portal_credit_notes(text, text) to service_role;

-- 9) «send from date» also sends credit notes made while Qoyod was off
create or replace function public.qoyod_backfill(p_org uuid, p_from date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_before int;
  v_after int;
begin
  if not private.has_permission(p_org, 'settings.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_from > current_date then
    raise exception 'invalid date' using errcode = '22023';
  end if;
  select count(*) into v_before from public.qoyod_sync_jobs where organization_id = p_org;
  update public.qoyod_settings set sync_from = p_from where organization_id = p_org;

  perform private.qoyod_enqueue(p.organization_id, 'invoice', 'contract_payment', p.id, 'cp:' || p.id)
  from public.contract_payments p
  where p.organization_id = p_org and p.status in ('requested', 'paid') and coalesce(p.requested_at, p.paid_at, p.created_at) >= p_from;
  perform private.qoyod_enqueue(p.organization_id, 'invoice_payment', 'contract_payment', p.id, 'cp:' || p.id || ':' || p.paid_amount, p.paid_amount)
  from public.contract_payments p
  where p.organization_id = p_org and coalesce(p.paid_amount, 0) > 0 and coalesce(p.paid_at, p.created_at) >= p_from;

  perform private.qoyod_enqueue(a.organization_id, 'invoice', 'addendum', a.id, 'ad:' || a.id)
  from public.addenda a
  where a.organization_id = p_org and a.status = 'accepted' and coalesce(a.accepted_at, a.created_at) >= p_from;
  perform private.qoyod_enqueue(a.organization_id, 'invoice_payment', 'addendum', a.id, 'ad:' || a.id || ':' || a.paid_amount, a.paid_amount)
  from public.addenda a
  where a.organization_id = p_org and coalesce(a.paid_amount, 0) > 0 and coalesce(a.paid_at::timestamptz, a.created_at) >= p_from;

  perform private.qoyod_enqueue(p.organization_id, 'bill', 'purchase', p.id, 'po:' || p.id)
  from public.purchases p
  where p.organization_id = p_org and p.status = 'recorded' and p.total > 0 and coalesce(p.invoice_date::timestamptz, p.recorded_at, p.created_at) >= p_from;
  perform private.qoyod_enqueue(p.organization_id, 'bill_payment', 'purchase', p.id, 'pp:' || p.id, p.total)
  from public.purchases p
  where p.organization_id = p_org and p.status = 'recorded' and p.total > 0 and p.paid_on is not null and p.paid_on >= p_from;

  perform private.qoyod_enqueue(s.organization_id, 'bill', 'subcontractor_payment', s.id, 'sb:' || s.id)
  from public.subcontractor_payments s where s.organization_id = p_org and s.paid_on >= p_from;
  perform private.qoyod_enqueue(s.organization_id, 'bill_payment', 'subcontractor_payment', s.id, 'sp:' || s.id, s.amount)
  from public.subcontractor_payments s where s.organization_id = p_org and s.paid_on >= p_from;

  perform private.qoyod_enqueue(k.organization_id, 'bill', 'commission_payment', k.id, 'mk:' || k.id)
  from public.commission_payments k where k.organization_id = p_org and k.paid_on >= p_from;
  perform private.qoyod_enqueue(k.organization_id, 'bill_payment', 'commission_payment', k.id, 'mkp:' || k.id, k.amount)
  from public.commission_payments k where k.organization_id = p_org and k.paid_on >= p_from;

  -- credit notes (a signed measurement reduced what was invoiced) and their allocation to an unpaid invoice
  perform private.qoyod_enqueue(n.organization_id, 'credit_note', 'credit_note', n.id, 'cn:' || n.id)
  from public.credit_notes n where n.organization_id = p_org and n.issue_date >= p_from;
  perform private.qoyod_enqueue(n.organization_id, 'credit_allocation', 'credit_note', n.id, 'cna:' || n.id, n.total)
  from public.credit_notes n where n.organization_id = p_org and n.payment_id is not null and n.issue_date >= p_from;

  perform private.qoyod_enqueue_petty(p_org, p_from);

  select count(*) into v_after from public.qoyod_sync_jobs where organization_id = p_org;
  return v_after - v_before;
end;
$function$;

-- 10) client page invoices: paid in full = the invoice less its credit notes (same rule as invoicePaid in the app)
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
      'paid', case when p.status = 'paid' or a.payment_status = 'paid'
                   then greatest(i.total - coalesce((select sum(n.total) from public.credit_notes n where n.invoice_id = i.id), 0), coalesce(p.paid_amount, a.paid_amount, 0))
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
