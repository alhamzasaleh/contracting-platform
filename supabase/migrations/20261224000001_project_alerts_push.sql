-- =============================================================================
-- Project alerts + push notifications to devices (§3.16, §3.18)
--   New notification kinds (raised by the daily job, deduplicated):
--     project_delay       — accepted contract past its delivery date, not handed over
--     project_over_budget — actual material cost passed the estimate (100/110/125/150 %)
--     project_losing      — actual profit below zero or below half the expected profit
--     missed_visit        — work under way and no site check-in for 3 / 7 / 14 days
--   Push: each user may enable notifications on any device (Web Push). Devices are
--   stored per user (only the user sees / removes their own). The server key pair
--   (VAPID) is generated once and kept in a private table (service role only).
--   notification_deliveries gains channel 'push' (one delivery per notification;
--   the sender fans out to the user's devices).
-- =============================================================================

-- Kinds ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted',
  'payment_received', 'payment_late', 'doc_expiry', 'approval_reminder', 'maintenance_request',
  'project_delay', 'project_over_budget', 'project_losing', 'missed_visit'));
alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check check (kind in ('approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted',
  'payment_received', 'payment_late', 'doc_expiry', 'approval_reminder', 'maintenance_request',
  'project_delay', 'project_over_budget', 'project_losing', 'missed_visit'));

alter table public.notification_preferences add column push boolean not null default true;
grant update (push) on public.notification_preferences to authenticated;

-- Devices ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- only the browsers' own push services (no arbitrary hosts: the server posts to this URL)
  endpoint text not null unique check (char_length(endpoint) <= 1000 and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  device text check (char_length(device) <= 120),
  failures int not null default 0,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
create trigger push_subscriptions_created_by before insert on public.push_subscriptions for each row execute function private.set_created_by();

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_member(organization_id)));
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_member(organization_id)));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

-- A user may have at most 10 devices.
create or replace function private.guard_push_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.push_subscriptions where user_id = new.user_id) >= 10 then
    raise exception 'too many devices' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger push_subscriptions_guard before insert on public.push_subscriptions for each row execute function private.guard_push_subscription();

-- Server key pair (generated once by the server, service role only).
create table private.push_keys (
  id boolean primary key default true check (id),
  public_key text not null check (public_key ~ '^[A-Za-z0-9_-]{80,100}$'),
  private_key text not null check (private_key ~ '^[A-Za-z0-9_-]{40,50}$'),
  created_at timestamptz not null default now()
);
revoke all on private.push_keys from public;

create or replace function public.push_vapid_keys(p_public text default null, p_private text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k private.push_keys;
begin
  if p_public is not null and p_private is not null then
    insert into private.push_keys (public_key, private_key) values (p_public, p_private) on conflict (id) do nothing;
  end if;
  select * into k from private.push_keys where id;
  if k.id is null then
    return null;
  end if;
  return jsonb_build_object('public_key', k.public_key, 'private_key', k.private_key);
end;
$$;
revoke all on function public.push_vapid_keys(text, text) from public, anon, authenticated;
grant execute on function public.push_vapid_keys(text, text) to service_role;

-- Outbox: 'push' deliveries have no phone.
alter table public.notification_deliveries drop constraint notification_deliveries_channel_check;
alter table public.notification_deliveries add constraint notification_deliveries_channel_check check (channel in ('whatsapp', 'push'));
alter table public.notification_deliveries alter column phone drop not null;
alter table public.notification_deliveries add column user_id uuid references auth.users (id) on delete cascade;
alter table public.notification_deliveries add constraint notification_deliveries_target_check
  check ((channel = 'whatsapp' and phone is not null) or (channel = 'push' and phone is null and user_id is not null));
create index notification_deliveries_channel_idx on public.notification_deliveries (channel, status, created_at) where status = 'queued';

create or replace function private.notify(p_org uuid, p_permission text, p_kind text, p_params jsonb, p_link text, p_dedupe text default null)
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
begin
  for m in select ms.user_id from public.memberships ms
           where ms.organization_id = p_org and ms.status = 'active' loop
    if not (p_permission = any (private.member_permissions(p_org, m.user_id))) then
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
revoke all on function private.notify(uuid, text, text, jsonb, text, text) from public;

-- Project figures used by the alerts (same rules as the owner's dashboard) -----------
-- Actual cost: materials issued to the project + expense lines (VAT is cost without a
-- company VAT number) + petty cash spent on it; subcontractors' earned work separately.
create or replace function private.project_actuals(p_contract uuid)
returns table (materials numeric, subcontractors numeric)
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
              join public.subcontractor_agreements g on g.id = w.agreement_id where g.contract_id = p_contract), 0)
$$;
revoke all on function private.project_actuals(uuid) from public;

-- Daily reminders, now with project alerts -------------------------------------------
create or replace function public.run_daily_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
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
    select p.id, p.organization_id, p.label, p.amount - coalesce(p.paid_amount, 0) as left_amount, c.number,
           (v_today - (p.requested_at at time zone 'Asia/Riyadh')::date) as age
    from public.contract_payments p join public.contracts c on c.id = p.contract_id
    where p.status = 'requested' and p.requested_at is not null
      and (v_today - (p.requested_at at time zone 'Asia/Riyadh')::date) in (7, 14, 30, 60, 90)
  loop
    perform private.notify(r.organization_id, 'finance.view', 'payment_late',
      jsonb_build_object('number', r.number, 'label', r.label, 'amount', r.left_amount, 'days', r.age), '/reports', 'late:' || r.id || ':' || r.age);
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
    select a.id, a.organization_id, a.kind, a.details ->> 'number' as number
    from public.approvals a
    where a.status = 'pending' and a.created_at < now() - interval '1 day'
  loop
    perform private.notify(r.organization_id, 'approvals.decide', 'approval_reminder',
      jsonb_build_object('approval_id', r.id, 'kind', r.kind, 'number', r.number), '/', 'remind:' || r.id || ':' || v_today);
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
        '/contracts/' || r.number, 'delay:' || r.id || ':' || (v_today - r.due));
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
          '/contracts/' || r.number, 'visit:' || r.id || ':' || v_last || ':' || v_gap);
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
        '/contracts/' || r.number, 'budget:' || r.id || ':' || v_bucket);
      v_count := v_count + 1;
    end if;

    select r.total - coalesce((qv.client_view ->> 'vat')::numeric, 0) into v_revenue
    from public.quote_versions qv where qv.quote_id = r.quote_id and qv.version = r.quote_version;
    v_revenue := coalesce(v_revenue, r.total)
      + coalesce((select sum(a.amount) from public.addenda a where a.contract_id = r.id and a.status = 'accepted'), 0);
    v_actual := v_revenue - (v_act.materials + v_act.subcontractors);
    v_expected := case when v_est_all > 0 then v_revenue - v_est_all end;
    if (v_act.materials + v_act.subcontractors) > 0 and (v_actual < 0 or (v_expected is not null and v_expected > 0 and v_actual < v_expected * 0.5)) then
      perform private.notify(r.organization_id, 'costs.view', 'project_losing',
        jsonb_build_object('number', r.number, 'client', r.client, 'profit', round(v_actual, 2), 'expected', round(v_expected, 2)),
        '/reports', 'losing:' || r.id || ':' || case when v_actual < 0 then 'loss' else 'low' end);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.run_daily_reminders() from public, anon, authenticated;
grant execute on function public.run_daily_reminders() to service_role;
