-- =============================================================================
-- Review batch 2 (Nov 2026): connections & consistent numbers.
--   #9  a client-page link (new or reissued) lasts at least until the real
--       warranty end (+1 day) and the planned end incl. accepted addenda days.
--   #12 additional works get an estimated cost (addendum_costs, costs.view) used by
--       the over-budget / profit alerts; accepting one flags the project's
--       subcontractor agreements for review (the addendum has no area to add).
--   #14 invoices and receipt vouchers are finance documents: finance.view.
--   #17 maintenance covered by the warranty (we pay for it) is part of a project's actual
--       cost; the profit alert also watches handed-over projects during the warranty.
--   G4  subcontractor payments and petty-cash expenses reach Qoyod (simple bill +
--       its payment), like supplier purchases; subcontracting expense account.
--   Qoyod account choices added after the first release (salary, cash) were not
--       writable by the settings screen (column grants) — granted with the new one.
-- Non-destructive: new table/columns, wider checks, new triggers, redefined functions.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- #9 Client-page link expiry floor
-- ---------------------------------------------------------------------------
create or replace function private.portal_link_floor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.contracts;
  v_days int;
  v_planned timestamptz;
  v_end date;
begin
  select * into c from public.contracts where id = new.contract_id;
  if c.id is null then
    return new;
  end if;
  select coalesce(sum(a.extra_days), 0)::int into v_days from public.addenda a where a.contract_id = c.id and a.status = 'accepted';
  -- planned: start + duration + accepted addenda days + 30 days grace + warranty
  v_planned := ((c.start_date + c.duration_days + v_days + 30 + make_interval(months => c.warranty_months))::date)::timestamp at time zone 'Asia/Riyadh';
  v_end := private.warranty_end(c.id);
  new.expires_at := greatest(new.expires_at, v_planned,
    case when v_end is not null then ((v_end + 1)::timestamp at time zone 'Asia/Riyadh') end);
  return new;
end;
$$;
revoke all on function private.portal_link_floor() from public;
-- fires after client_portal_links_guard (alphabetical), so the guard sees what staff asked for
create trigger client_portal_links_set_expiry before insert on public.client_portal_links
  for each row execute function private.portal_link_floor();

-- ---------------------------------------------------------------------------
-- #12 Additional works: estimated cost (costs.view)
-- ---------------------------------------------------------------------------
create table public.addendum_costs (
  addendum_id uuid primary key references public.addenda (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete restrict,
  material_cost numeric(14, 2) not null default 0 check (material_cost >= 0),
  other_cost numeric(14, 2) not null default 0 check (other_cost >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index addendum_costs_contract_idx on public.addendum_costs (contract_id);

-- the contract and organization always come from the addendum
create or replace function private.addendum_costs_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.addenda;
begin
  select * into a from public.addenda where id = new.addendum_id;
  if a.id is null or a.organization_id <> new.organization_id then
    raise exception 'invalid addendum' using errcode = '22023';
  end if;
  new.contract_id := a.contract_id;
  return new;
end;
$$;
revoke all on function private.addendum_costs_refs() from public;
create trigger addendum_costs_refs before insert or update on public.addendum_costs for each row execute function private.addendum_costs_refs();
create trigger addendum_costs_created_by before insert on public.addendum_costs for each row execute function private.set_created_by();
create trigger addendum_costs_updated_at before update on public.addendum_costs for each row execute function private.set_updated_at();
select private.enable_audit('public.addendum_costs');

alter table public.addendum_costs enable row level security;
create policy addendum_costs_select on public.addendum_costs for select to authenticated
  using ((select private.has_permission(organization_id, 'costs.view')));
create policy addendum_costs_insert on public.addendum_costs for insert to authenticated
  with check ((select private.has_permission(organization_id, 'costs.view')) and (select private.has_permission(organization_id, 'quotes.manage')));
create policy addendum_costs_update on public.addendum_costs for update to authenticated
  using ((select private.has_permission(organization_id, 'costs.view')) and (select private.has_permission(organization_id, 'quotes.manage')))
  with check ((select private.has_permission(organization_id, 'costs.view')) and (select private.has_permission(organization_id, 'quotes.manage')));
create policy addendum_costs_delete on public.addendum_costs for delete to authenticated
  using ((select private.has_permission(organization_id, 'costs.view')) and (select private.has_permission(organization_id, 'quotes.manage')));
create policy addendum_costs_project_scope on public.addendum_costs as restrictive for all to authenticated
  using (private.can_access_contract(organization_id, contract_id))
  with check (private.can_access_contract(organization_id, contract_id));
revoke all on public.addendum_costs from anon, authenticated;
grant select, insert, update, delete on public.addendum_costs to authenticated;
grant all on public.addendum_costs to service_role;

-- Accepting an addendum flags the project's active subcontractor agreements for review
-- (its scope grew; the addendum has no measured area to add automatically).
alter table public.subcontractor_agreements
  add column review_addendum_id uuid references public.addenda (id) on delete set null;

-- New notification kind: an agreement to review (purchasing / finance staff).
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted',
  'payment_received', 'payment_late', 'doc_expiry', 'approval_reminder', 'maintenance_request',
  'project_delay', 'project_over_budget', 'project_losing', 'missed_visit', 'agreement_review'));
alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check check (kind in ('approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted',
  'payment_received', 'payment_late', 'doc_expiry', 'approval_reminder', 'maintenance_request',
  'project_delay', 'project_over_budget', 'project_losing', 'missed_visit', 'agreement_review'));

create or replace function private.flag_agreements_on_addendum()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
  v_number text;
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    update public.subcontractor_agreements set review_addendum_id = new.id
    where contract_id = new.contract_id and status = 'active';
    get diagnostics v_count = row_count;
    if v_count > 0 then
      select number into v_number from public.contracts where id = new.contract_id;
      -- purchasing and finance staff who can see the project; one notification each (same dedupe key)
      perform private.notify(new.organization_id, 'purchases.manage', 'agreement_review',
        jsonb_build_object('number', v_number, 'addendum', new.number, 'count', v_count), '/purchases/subcontractors', 'agreement_review:' || new.id, new.contract_id);
      perform private.notify(new.organization_id, 'finance.manage', 'agreement_review',
        jsonb_build_object('number', v_number, 'addendum', new.number, 'count', v_count), '/purchases/subcontractors', 'agreement_review:' || new.id, new.contract_id);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.flag_agreements_on_addendum() from public;
create trigger addenda_flag_agreements after update of status on public.addenda
  for each row execute function private.flag_agreements_on_addendum();

-- Staff can't raise the flag; any edit they save counts as the review and clears it.
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
    if new.review_addendum_id is not null then
      raise exception 'the review flag is set by the database' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.review_addendum_id is not null and new.review_addendum_id is distinct from old.review_addendum_id then
    raise exception 'the review flag is set by the database' using errcode = '42501';
  end if;
  new.review_addendum_id := null;
  return new;
end;
$$;
create trigger subcontractor_agreements_review before insert or update on public.subcontractor_agreements
  for each row execute function private.guard_agreement_review();

-- ---------------------------------------------------------------------------
-- #14 Invoices and receipt vouchers: finance.view (pages, print, nav, RLS agree)
-- ---------------------------------------------------------------------------
drop policy invoices_select on public.invoices;
create policy invoices_select on public.invoices for select to authenticated
  using ((select private.has_permission(organization_id, 'finance.view')));
drop policy client_receipts_select on public.client_receipts;
create policy client_receipts_select on public.client_receipts for select to authenticated
  using ((select private.has_permission(organization_id, 'finance.view')));

-- ---------------------------------------------------------------------------
-- #17 Actual cost: + maintenance covered by the warranty (the company pays; repairs
--     charged to the client are not our cost)
-- ---------------------------------------------------------------------------
drop function private.project_actuals(uuid);
create or replace function private.project_actuals(p_contract uuid)
returns table (materials numeric, subcontractors numeric, labour numeric, maintenance numeric)
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
    private.project_labour(p_contract),
    coalesce((select sum(r.cost) from public.maintenance_requests r where r.contract_id = p_contract and r.covered), 0)
$$;
revoke all on function private.project_actuals(uuid) from public;

-- Daily reminders: estimates include accepted addenda (#12), actual includes warranty
-- maintenance (#17); handed-over projects still inside the warranty are checked for
-- project_losing only (same dedupe key: one alert per state). Otherwise the batch 1 definition.
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
      + coalesce((select sum(a.amount) from public.addenda a where a.contract_id = r.id and a.status = 'accepted'), 0);
    v_cost := v_act.materials + v_act.subcontractors + v_act.labour + v_act.maintenance;
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
  return v_count;
end;
$$;
revoke all on function public.run_daily_reminders() from public, anon, authenticated;
grant execute on function public.run_daily_reminders() to service_role;

-- ---------------------------------------------------------------------------
-- G4 Qoyod: subcontractor payments and petty-cash expenses
-- ---------------------------------------------------------------------------
alter table public.qoyod_settings
  add column subcontract_account_id int check (subcontract_account_id > 0);

-- the settings screen writes these (salary/cash were added without their column grants)
grant insert (salary_account_id, cash_account_id, subcontract_account_id) on public.qoyod_settings to authenticated;
grant update (salary_account_id, cash_account_id, subcontract_account_id) on public.qoyod_settings to authenticated;

-- the worker's last automatic setup run (optional accounts missing → retried at most daily); service role only
alter table public.qoyod_settings add column auto_setup_at timestamptz;

-- petty-cash top-ups / returns: bank ↔ cash journal entries
alter table public.qoyod_sync_jobs drop constraint qoyod_sync_jobs_kind_check;
alter table public.qoyod_sync_jobs add constraint qoyod_sync_jobs_kind_check
  check (kind in ('customer', 'vendor', 'invoice', 'invoice_payment', 'bill', 'bill_payment', 'payroll', 'transfer'));

alter table public.qoyod_sync_jobs drop constraint qoyod_sync_jobs_entity_type_check;
alter table public.qoyod_sync_jobs add constraint qoyod_sync_jobs_entity_type_check
  check (entity_type in ('client', 'supplier', 'subcontractor', 'contract_payment', 'addendum', 'purchase', 'payroll_run', 'subcontractor_payment', 'petty_cash'));

-- A payment to a subcontractor = a simple bill (subcontracting expense) + its payment.
create or replace function private.qoyod_on_subcontractor_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.qoyod_enqueue(new.organization_id, 'bill', 'subcontractor_payment', new.id, 'sb:' || new.id);
  perform private.qoyod_enqueue(new.organization_id, 'bill_payment', 'subcontractor_payment', new.id, 'sp:' || new.id, new.amount);
  return null;
end;
$$;
revoke all on function private.qoyod_on_subcontractor_payment() from public;
create trigger subcontractor_payments_qoyod after insert on public.subcontractor_payments
  for each row execute function private.qoyod_on_subcontractor_payment();

-- A petty-cash expense = a simple bill paid from the cash account; a top-up / return = a
-- journal entry bank → cash / cash → bank (kind 'transfer', waits for "Approved" like payroll).
create or replace function private.qoyod_on_petty_cash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'expense' then
    perform private.qoyod_enqueue(new.organization_id, 'bill', 'petty_cash', new.id, 'pc:' || new.id);
    perform private.qoyod_enqueue(new.organization_id, 'bill_payment', 'petty_cash', new.id, 'pcp:' || new.id, new.amount);
  else
    perform private.qoyod_enqueue(new.organization_id, 'transfer', 'petty_cash', new.id, 'pct:' || new.id, new.amount);
  end if;
  return null;
end;
$$;
revoke all on function private.qoyod_on_petty_cash() from public;
create trigger petty_cash_entries_qoyod after insert on public.petty_cash_entries
  for each row execute function private.qoyod_on_petty_cash();

-- Backfill: also supplier payments, subcontractor payments and petty-cash expenses.
create or replace function public.qoyod_backfill(p_org uuid, p_from date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
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

  perform private.qoyod_enqueue(e.organization_id, 'bill', 'petty_cash', e.id, 'pc:' || e.id)
  from public.petty_cash_entries e where e.organization_id = p_org and e.kind = 'expense' and e.entry_date >= p_from;
  perform private.qoyod_enqueue(e.organization_id, 'bill_payment', 'petty_cash', e.id, 'pcp:' || e.id, e.amount)
  from public.petty_cash_entries e where e.organization_id = p_org and e.kind = 'expense' and e.entry_date >= p_from;
  perform private.qoyod_enqueue(e.organization_id, 'transfer', 'petty_cash', e.id, 'pct:' || e.id, e.amount)
  from public.petty_cash_entries e where e.organization_id = p_org and e.kind in ('topup', 'return') and e.entry_date >= p_from;

  select count(*) into v_after from public.qoyod_sync_jobs where organization_id = p_org;
  return v_after - v_before;
end;
$$;
revoke all on function public.qoyod_backfill(uuid, date) from public, anon;
grant execute on function public.qoyod_backfill(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Provisions (end-of-service, annual leave) are accruals, not cash: the cash-flow
-- forecast leaves them out. Editable on the cost items screen.
-- ---------------------------------------------------------------------------
alter table public.employee_cost_items add column is_provision boolean not null default false;
update public.employee_cost_items set is_provision = true where code in ('eos_accrual', 'annual_leave');

create or replace function public.seed_employee_cost_items(p_org uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if not private.has_permission(p_org, 'hr.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.employee_cost_items (organization_id, code, name_ar, applies_to, basis, amortize_months, sort_order, is_provision)
  values
    (p_org, 'gosi_saudi', 'التأمينات الاجتماعية (حصة المنشأة) — سعودي', 'saudi', 'percent', null, 1, false),
    (p_org, 'gosi_non_saudi', 'التأمينات الاجتماعية (أخطار مهنية) — غير سعودي', 'non_saudi', 'percent', null, 2, false),
    (p_org, 'medical_insurance', 'التأمين الطبي', 'all', 'annual', null, 3, false),
    (p_org, 'eos_accrual', 'مخصص مكافأة نهاية الخدمة', 'all', 'percent', null, 4, true),
    (p_org, 'annual_leave', 'مخصص الإجازة السنوية', 'all', 'percent', null, 5, true),
    (p_org, 'iqama', 'إصدار/تجديد الإقامة', 'non_saudi', 'annual', null, 6, false),
    (p_org, 'work_permit_levy', 'رخصة العمل والمقابل المالي', 'non_saudi', 'annual', null, 7, false),
    (p_org, 'exit_reentry', 'تأشيرات الخروج والعودة', 'non_saudi', 'annual', null, 8, false),
    (p_org, 'leave_ticket', 'تذكرة الإجازة السنوية', 'non_saudi', 'annual', null, 9, false),
    (p_org, 'recruitment', 'الاستقدام (تأشيرة، مكتب، تذكرة، فحص)', 'non_saudi', 'one_time', 24, 10, false),
    (p_org, 'sponsorship_transfer', 'نقل الكفالة / نقل الخدمات', 'non_saudi', 'one_time', 24, 11, false),
    (p_org, 'housing', 'السكن (إن لم يكن بدلاً في الراتب)', 'all', 'monthly', null, 12, false),
    (p_org, 'transport', 'النقل (إن لم يكن بدلاً في الراتب)', 'all', 'monthly', null, 13, false)
  on conflict (organization_id, code) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.seed_employee_cost_items(uuid) from public, anon;
grant execute on function public.seed_employee_cost_items(uuid) to authenticated;
