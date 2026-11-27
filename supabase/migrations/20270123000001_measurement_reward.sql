-- The success partner's reward follows what the client really pays (owner, Nov 2026): its base = the agreed
-- value before VAT (version subtotal − discount) + the quantity settlement the client signed (Σ approved
-- measurement diff_subtotal). A reward may now be paid in more than one voucher: when a later sheet raises
-- it after it was paid, the difference becomes payable once the contract is fully paid again; when a sheet
-- lowers it below what was paid, finance is told (nothing is taken back automatically).

alter table public.marketer_commissions add column paid_amount numeric(14, 2) not null default 0 check (paid_amount >= 0);
update public.marketer_commissions k set paid_amount = coalesce((select sum(v.amount) from public.commission_payments v where v.commission_id = k.id), 0);
alter table public.commission_payments drop constraint commission_payments_commission_id_key;
create index commission_payments_commission_idx on public.commission_payments (commission_id);
-- a voucher keeps the base and % it was paid on (a later measurement re-bases the reward, never a voucher)
alter table public.commission_payments add column base numeric(14, 2);
alter table public.commission_payments add column percent numeric(5, 2);
alter table public.commission_payments add column paid_before numeric(14, 2) not null default 0;
update public.commission_payments v set base = k.base, percent = k.percent from public.marketer_commissions k where k.id = v.commission_id;

create or replace function public.record_commission_payment(p_commission uuid, p_paid_on date, p_method text, p_reference text default null, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.marketer_commissions;
  v_number text;
  v_left numeric;
begin
  select * into k from public.marketer_commissions where id = p_commission for update;
  if k.id is null or not private.has_permission(k.organization_id, 'finance.manage') or not private.can_access_contract(k.organization_id, k.contract_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if k.status = 'paid' then
    raise exception 'commission already paid' using errcode = '22023';
  end if;
  if k.status <> 'due' then
    raise exception 'commission not due' using errcode = '22023';
  end if;
  -- what is left of it (all of it, or the part a later measurement added)
  v_left := round(k.amount - k.paid_amount, 2);
  if v_left <= 0 then
    raise exception 'nothing to pay' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Asia/Riyadh')::date or p_paid_on < (now() at time zone 'Asia/Riyadh')::date - 366 then
    raise exception 'invalid date' using errcode = '22023';
  end if;
  if p_paid_on < (k.due_at at time zone 'Asia/Riyadh')::date then
    raise exception 'invalid date: before the reward was due' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('transfer', 'cash', 'cheque') then
    raise exception 'invalid method' using errcode = '22023';
  end if;
  if char_length(coalesce(p_reference, '')) > 80 or char_length(coalesce(p_note, '')) > 500 then
    raise exception 'invalid' using errcode = '22023';
  end if;
  insert into public.commission_payments (organization_id, commission_id, marketer_id, contract_id, amount, paid_on, method, reference, note, base, percent, paid_before)
  values (k.organization_id, k.id, k.marketer_id, k.contract_id, v_left, p_paid_on, p_method, nullif(trim(p_reference), ''), nullif(trim(p_note), ''), k.base, k.percent, k.paid_amount)
  returning number into v_number;
  update public.marketer_commissions set status = 'paid', paid_at = now(), paid_amount = paid_amount + v_left where id = k.id;
  return v_number;
end;
$$;

-- recompute a contract's reward from the agreed value + the signed quantity settlement
create or replace function private.commission_rebase(p_contract uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.marketer_commissions;
  c public.contracts;
  v_base numeric;
  v_amount numeric;
  v_number text;
  v_name text;
begin
  select * into k from public.marketer_commissions where contract_id = p_contract and status <> 'cancelled' for update;
  if k.id is null then
    return;
  end if;
  select * into c from public.contracts where id = p_contract;
  select greatest(qv.subtotal - qv.discount
                  + coalesce((select sum(m.diff_subtotal) from public.contract_measurements m where m.contract_id = p_contract and m.status = 'approved'), 0), 0)
  into v_base
  from public.quote_versions qv where qv.quote_id = c.quote_id and qv.version = c.quote_version;
  if v_base is null then
    return;
  end if;
  v_amount := round(v_base * k.percent / 100, 2);
  update public.marketer_commissions set base = round(v_base, 2), amount = v_amount where id = k.id;
  select m.name into v_name from public.marketers m where m.id = k.marketer_id;
  if k.paid_amount > 0 and v_amount <= k.paid_amount + 0.005 then
    -- nothing left to pay (lowered back to, or below, what was paid)
    update public.marketer_commissions set status = 'paid' where id = k.id;
  elsif k.status = 'paid' then
    -- raised after it was paid: the rest is payable once the contract is fully paid again
    update public.marketer_commissions set status = 'expected', due_at = null where id = k.id;
  end if;
  -- runs at the end of the transaction (deferred trigger): the settlement payments already exist
  perform private.commission_sync(p_contract);
  if v_amount < k.paid_amount - 0.005 then
    perform private.notify(k.organization_id, 'finance.manage', 'commission_overpaid',
      jsonb_build_object('number', c.number, 'marketer', v_name, 'amount', round(k.paid_amount - v_amount, 2)),
      '/partners?k=' || k.id, 'commission_overpaid:' || k.id || ':' || v_amount, p_contract);
  end if;
end;
$$;
revoke all on function private.commission_rebase(uuid) from public;

create or replace function private.commission_on_measurement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform private.commission_rebase(new.contract_id);
  end if;
  return null;
end;
$$;
revoke all on function private.commission_on_measurement() from public;
-- deferred: re-based at the end of the client's answer, after its settlement payments were made
create constraint trigger contract_measurements_commission after update of status on public.contract_measurements
  deferrable initially deferred
  for each row execute function private.commission_on_measurement();

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted', 'payment_received', 'payment_late',
  'doc_expiry', 'approval_reminder', 'maintenance_request', 'project_delay', 'project_over_budget', 'project_losing', 'missed_visit',
  'agreement_review', 'quote_accepted', 'quote_changes_requested', 'quote_rejected', 'commission_due',
  'measurement_approved', 'measurement_objected', 'measurement_waiting', 'measurement_credit', 'commission_overpaid'));
alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check check (kind in (
  'approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted', 'payment_received', 'payment_late',
  'doc_expiry', 'approval_reminder', 'maintenance_request', 'project_delay', 'project_over_budget', 'project_losing', 'missed_visit',
  'agreement_review', 'quote_accepted', 'quote_changes_requested', 'quote_rejected', 'commission_due',
  'measurement_approved', 'measurement_objected', 'measurement_waiting', 'measurement_credit', 'commission_overpaid'));

-- due again after a raise: the notification says what is left, and is sent again (dedupe per paid amount)
create or replace function private.commission_sync(p_contract uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.marketer_commissions;
  v_paid boolean;
  v_number text;
  v_name text;
begin
  select * into k from public.marketer_commissions where contract_id = p_contract and status in ('expected', 'due') for update;
  if k.id is null then
    return;
  end if;
  if k.paid_amount > 0 and k.amount <= k.paid_amount + 0.005 then
    update public.marketer_commissions set status = 'paid' where id = k.id;
    return;
  end if;
  select exists (select 1 from public.contract_payments p where p.contract_id = p_contract)
         and not exists (select 1 from public.contract_payments p where p.contract_id = p_contract and p.status <> 'paid')
  into v_paid;
  if v_paid and k.status = 'expected' then
    update public.marketer_commissions set status = 'due', due_at = now() where id = k.id;
    select c.number into v_number from public.contracts c where c.id = p_contract;
    select m.name into v_name from public.marketers m where m.id = k.marketer_id;
    perform private.notify(k.organization_id, 'finance.manage', 'commission_due',
      jsonb_build_object('number', v_number, 'marketer', v_name, 'amount', round(k.amount - k.paid_amount, 2)),
      '/partners?k=' || k.id, 'commission_due:' || k.id || ':' || k.paid_amount || ':' || k.amount, p_contract);
  elsif not v_paid and k.status = 'due' then
    update public.marketer_commissions set status = 'expected', due_at = null where id = k.id;
  end if;
end;
$$;

-- the partner's page: what was paid so far; vouchers keep their own base / %
create or replace function public.marketer_portal_view(p_number text, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  l public.marketer_portal_links;
  m public.marketers;
  o public.organizations;
begin
  l := private.marketer_link(p_number, p_token);
  if l.id is null then
    return null;
  end if;
  select * into m from public.marketers where id = l.marketer_id;
  select * into o from public.organizations where id = l.organization_id;
  return jsonb_build_object(
    'org', jsonb_build_object('id', o.id, 'name', o.name, 'legal_name', o.legal_name, 'phone', o.phone, 'logo_path', o.logo_path, 'brand', o.brand),
    'marketer', jsonb_build_object('number', m.number, 'name', m.name, 'commission_percent', m.commission_percent),
    'expires_at', l.expires_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client', cl.name, 'contract', c.number, 'date', coalesce(c.accepted_at, c.created_at), 'contract_status', c.status,
        'handed_over', exists (select 1 from public.project_stages s where s.contract_id = c.id and s.is_final and s.status = 'confirmed'),
        'base', k.base, 'percent', k.percent, 'amount', k.amount, 'paid_amount', k.paid_amount, 'status', k.status, 'due_at', k.due_at, 'paid_at', k.paid_at,
        'vouchers', coalesce((select jsonb_agg(jsonb_build_object('number', v.number, 'paid_on', v.paid_on, 'amount', v.amount, 'method', v.method) order by v.paid_on)
                              from public.commission_payments v where v.commission_id = k.id), '[]'::jsonb))
        order by coalesce(c.accepted_at, c.created_at) desc)
      from public.marketer_commissions k
      join public.contracts c on c.id = k.contract_id
      join public.clients cl on cl.id = c.client_id
      where k.marketer_id = m.id), '[]'::jsonb));
end;
$function$;

create or replace function public.marketer_portal_voucher(p_number text, p_token text, p_voucher text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  l public.marketer_portal_links;
  v public.commission_payments;
  o public.organizations;
begin
  l := private.marketer_link(p_number, p_token);
  if l.id is null or p_voucher is null or char_length(p_voucher) > 30 then
    return null;
  end if;
  select * into v from public.commission_payments x where x.number = p_voucher and x.marketer_id = l.marketer_id and x.organization_id = l.organization_id;
  if v.id is null then
    return null;
  end if;
  select * into o from public.organizations where id = l.organization_id;
  return jsonb_build_object(
    'org', jsonb_build_object('id', o.id, 'name', o.name, 'legal_name', o.legal_name, 'cr_number', o.cr_number, 'vat_number', o.vat_number, 'phone', o.phone,
                              'city', o.city, 'address', o.address, 'signatory_name', o.signatory_name, 'signatory_title', o.signatory_title, 'logo_path', o.logo_path, 'brand', o.brand),
    'voucher', jsonb_build_object('number', v.number, 'paid_on', v.paid_on, 'amount', v.amount, 'paid_before', v.paid_before, 'method', v.method, 'reference', v.reference, 'note', v.note),
    'marketer', (select jsonb_build_object('number', m.number, 'name', m.name, 'iban', m.iban) from public.marketers m where m.id = v.marketer_id),
    'contract', (select jsonb_build_object('number', c.number, 'client', cl.name, 'base', coalesce(v.base, k.base), 'percent', coalesce(v.percent, k.percent))
                 from public.contracts c join public.clients cl on cl.id = c.client_id join public.marketer_commissions k on k.id = v.commission_id
                 where c.id = v.contract_id));
end;
$function$;

-- daily reminders: what is left of a due reward, per payment cycle
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
    select k.id, k.organization_id, k.contract_id, round(k.amount - k.paid_amount, 2) as amount, k.paid_amount, c.number, m.name as marketer,
           (v_today - (k.due_at at time zone 'Asia/Riyadh')::date) as age
    from public.marketer_commissions k
    join public.contracts c on c.id = k.contract_id
    join public.marketers m on m.id = k.marketer_id
    where k.status = 'due' and k.due_at is not null and k.amount - k.paid_amount > 0.005
      and (v_today - (k.due_at at time zone 'Asia/Riyadh')::date) in (7, 14, 30)
  loop
    perform private.notify(r.organization_id, 'finance.manage', 'commission_due',
      jsonb_build_object('number', r.number, 'marketer', r.marketer, 'amount', r.amount, 'days', r.age),
      '/partners?k=' || r.id, 'commission_due:' || r.id || ':' || r.age || case when r.paid_amount > 0 then ':' || r.paid_amount else '' end, r.contract_id);
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
