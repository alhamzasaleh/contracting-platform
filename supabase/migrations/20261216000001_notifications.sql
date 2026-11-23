-- =============================================================================
-- Phase 9c — Notifications (§3.18)
--   notifications: one row per recipient (in-app bell). Created only by the
--     database (triggers on business events + the daily reminders job).
--   notification_preferences: per user and kind — in-app and/or WhatsApp.
--   notification_deliveries: WhatsApp outbox, sent by the server job once
--     the WhatsApp Business account is connected (service role only).
-- =============================================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted',
                                     'payment_received', 'payment_late', 'doc_expiry', 'approval_reminder')),
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object' and pg_column_size(params) < 4096),
  link text check (char_length(link) <= 200 and link ~ '^/'),
  dedupe_key text check (char_length(dedupe_key) <= 200),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.notification_preferences (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted',
                                     'payment_received', 'payment_late', 'doc_expiry', 'approval_reminder')),
  in_app boolean not null default true,
  whatsapp boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, kind)
);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel text not null default 'whatsapp' check (channel in ('whatsapp')),
  phone text not null check (phone ~ '^[0-9]{8,15}$'),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts int not null default 0,
  last_error text check (char_length(last_error) <= 300),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notification_deliveries_queue_idx on public.notification_deliveries (status, created_at) where status = 'queued';

-- Send one kind of notification to every member who holds a permission (and wants it).
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
      values (p_org, m.user_id, p_kind, coalesce(p_params, '{}'::jsonb), p_link, case when p_dedupe is null then null else p_dedupe end)
      on conflict (user_id, dedupe_key) do nothing
      returning id into v_id;
    else
      v_id := null;
    end if;
    if v_pref.whatsapp and v_id is not null then
      select p.phone into v_phone from public.profiles p where p.id = m.user_id;
      if v_phone ~ '^[0-9]{8,15}$' then
        insert into public.notification_deliveries (notification_id, organization_id, phone) values (v_id, p_org, v_phone);
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function private.notify(uuid, text, text, jsonb, text, text) from public;

-- Business events ------------------------------------------------------------------
create or replace function private.notify_on_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending' then
    perform private.notify(new.organization_id, 'approvals.decide', 'approval',
      jsonb_build_object('approval_id', new.id, 'kind', new.kind, 'number', new.details ->> 'number', 'total', new.details -> 'total'),
      '/', 'approval:' || new.id);
  end if;
  return null;
end;
$$;
create trigger approvals_notify after insert on public.approvals for each row execute function private.notify_on_approval();

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
    jsonb_build_object('number', v_number, 'body', left(new.body, 120)), '/projects/' || v_number, 'note:' || new.id);
  return null;
end;
$$;
create trigger client_notes_notify after insert on public.client_notes for each row execute function private.notify_on_client_note();

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
      jsonb_build_object('number', v_number, 'stage', new.name, 'final', new.is_final), '/projects/' || v_number, 'stage:' || new.id);
  end if;
  return null;
end;
$$;
create trigger project_stages_notify after update of status on public.project_stages for each row execute function private.notify_on_stage();

create or replace function private.notify_on_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and old.status <> 'accepted' then
    perform private.notify(new.organization_id, 'quotes.view', 'contract_accepted',
      jsonb_build_object('number', new.number, 'name', new.accepted_name), '/contracts/' || new.number, 'contract:' || new.id);
  end if;
  return null;
end;
$$;
create trigger contracts_notify after update of status on public.contracts for each row execute function private.notify_on_contract();

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
      jsonb_build_object('number', new.number, 'title', new.title), '/contracts/' || v_number, 'addendum:' || new.id);
  end if;
  return null;
end;
$$;
create trigger addenda_notify after update of status on public.addenda for each row execute function private.notify_on_addendum();

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
      '/reports', 'paid:' || new.id || ':' || new.paid_amount);
  end if;
  return null;
end;
$$;
create trigger contract_payments_notify after update of paid_amount on public.contract_payments for each row execute function private.notify_on_payment();

-- Daily reminders (run by the server job): late payments, expiring documents,
-- approvals still pending after a day. Deduplicated per day / threshold.
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
  return v_count;
end;
$$;
revoke all on function public.run_daily_reminders() from public, anon, authenticated;
grant execute on function public.run_daily_reminders() to service_role;

-- RLS: each user sees and marks only their own notifications; preferences are their own.
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_deliveries enable row level security;

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_member(organization_id)));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy notification_preferences_select on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_member(organization_id)));
create policy notification_preferences_insert on public.notification_preferences for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_member(organization_id)));
create policy notification_preferences_update on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select private.is_member(organization_id)));

revoke all on public.notifications, public.notification_preferences, public.notification_deliveries from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
grant all on public.notifications, public.notification_preferences, public.notification_deliveries to service_role;
