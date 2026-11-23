-- =============================================================================
-- Phase 10 — Qoyod (official accounting) link (§3.15)
--   The app records once; a queue sends it to Qoyod with retries:
--     contract / addendum payment requested  → sales invoice (customer created on demand)
--     client money recorded                  → invoice payment
--     purchase recorded                      → simple bill (vendor created on demand)
--   qoyod_settings: the owner's choices (accounts, warehouse, products, draft/approved).
--   The API key lives in schema private (never exposed through the API), written
--   through a checked function and read only by the server job (service role).
-- =============================================================================

create table public.qoyod_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  invoice_status text not null default 'Draft' check (invoice_status in ('Draft', 'Approved')),
  inventory_id int check (inventory_id > 0),
  receive_account_id int check (receive_account_id > 0),
  expense_account_id int check (expense_account_id > 0),
  service_products jsonb not null default '{}'::jsonb check (jsonb_typeof(service_products) = 'object' and pg_column_size(service_products) < 1024),
  addendum_product_id int check (addendum_product_id > 0),
  sync_from date,
  key_last4 text check (key_last4 ~ '^[A-Za-z0-9]{0,4}$'),
  key_set_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table private.qoyod_keys (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  api_key text not null check (char_length(api_key) between 8 and 200),
  updated_at timestamptz not null default now()
);
revoke all on private.qoyod_keys from public, anon, authenticated;

create table public.qoyod_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('customer', 'vendor', 'invoice', 'invoice_payment', 'bill')),
  entity_type text not null check (entity_type in ('client', 'supplier', 'contract_payment', 'addendum', 'purchase')),
  entity_id uuid not null,
  ref text not null check (char_length(ref) <= 120),
  amount numeric(14, 2),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text check (char_length(last_error) <= 500),
  qoyod_id int,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, kind, ref)
);
create index qoyod_jobs_queue_idx on public.qoyod_sync_jobs (status, next_attempt_at) where status in ('queued', 'running');
create index qoyod_jobs_entity_idx on public.qoyod_sync_jobs (entity_id, kind);

create trigger qoyod_settings_updated_at before update on public.qoyod_settings for each row execute function private.set_updated_at();
create trigger qoyod_sync_jobs_updated_at before update on public.qoyod_sync_jobs for each row execute function private.set_updated_at();
select private.enable_audit('public.qoyod_settings');

-- Key: only the settings manager can set it; the browser never reads it back.
create or replace function public.qoyod_set_key(p_org uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := btrim(coalesce(p_key, ''));
begin
  if not private.has_permission(p_org, 'settings.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_key = '' then
    delete from private.qoyod_keys where organization_id = p_org;
    insert into public.qoyod_settings (organization_id, enabled, key_last4, key_set_at, updated_by)
    values (p_org, false, null, null, auth.uid())
    on conflict (organization_id) do update set enabled = false, key_last4 = null, key_set_at = null, updated_by = auth.uid();
    return;
  end if;
  if v_key !~ '^[A-Za-z0-9_\-]{8,200}$' then
    raise exception 'invalid key' using errcode = '22023';
  end if;
  insert into private.qoyod_keys (organization_id, api_key) values (p_org, v_key)
  on conflict (organization_id) do update set api_key = excluded.api_key, updated_at = now();
  insert into public.qoyod_settings (organization_id, key_last4, key_set_at, updated_by)
  values (p_org, right(regexp_replace(v_key, '[^A-Za-z0-9]', '', 'g'), 4), now(), auth.uid())
  on conflict (organization_id) do update set key_last4 = excluded.key_last4, key_set_at = now(), updated_by = auth.uid();
end;
$$;
revoke all on function public.qoyod_set_key(uuid, text) from public, anon;
grant execute on function public.qoyod_set_key(uuid, text) to authenticated, service_role;

create or replace function public.qoyod_api_key(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select api_key from private.qoyod_keys where organization_id = p_org;
$$;
revoke all on function public.qoyod_api_key(uuid) from public, anon, authenticated;
grant execute on function public.qoyod_api_key(uuid) to service_role;

-- Queue ---------------------------------------------------------------------------
create or replace function private.qoyod_enqueue(p_org uuid, p_kind text, p_entity_type text, p_entity uuid, p_ref text, p_amount numeric default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.qoyod_settings s where s.organization_id = p_org and s.enabled) then
    return;
  end if;
  insert into public.qoyod_sync_jobs (organization_id, kind, entity_type, entity_id, ref, amount)
  values (p_org, p_kind, p_entity_type, p_entity, p_ref, p_amount)
  on conflict (organization_id, kind, ref) do nothing;
end;
$$;
revoke all on function private.qoyod_enqueue(uuid, text, text, uuid, text, numeric) from public;

create or replace function private.qoyod_on_contract_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('requested', 'paid') and (tg_op = 'INSERT' or old.status = 'pending') then
    perform private.qoyod_enqueue(new.organization_id, 'invoice', 'contract_payment', new.id, 'cp:' || new.id);
  end if;
  if coalesce(new.paid_amount, 0) > coalesce(old.paid_amount, 0) then
    perform private.qoyod_enqueue(new.organization_id, 'invoice', 'contract_payment', new.id, 'cp:' || new.id);
    perform private.qoyod_enqueue(new.organization_id, 'invoice_payment', 'contract_payment', new.id,
      'cp:' || new.id || ':' || new.paid_amount, new.paid_amount - coalesce(old.paid_amount, 0));
  end if;
  return null;
end;
$$;
create trigger contract_payments_qoyod after update of status, paid_amount on public.contract_payments
  for each row execute function private.qoyod_on_contract_payment();

create or replace function private.qoyod_on_addendum()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and old.status <> 'accepted' then
    perform private.qoyod_enqueue(new.organization_id, 'invoice', 'addendum', new.id, 'ad:' || new.id);
  end if;
  if coalesce(new.paid_amount, 0) > coalesce(old.paid_amount, 0) then
    perform private.qoyod_enqueue(new.organization_id, 'invoice', 'addendum', new.id, 'ad:' || new.id);
    perform private.qoyod_enqueue(new.organization_id, 'invoice_payment', 'addendum', new.id,
      'ad:' || new.id || ':' || new.paid_amount, new.paid_amount - coalesce(old.paid_amount, 0));
  end if;
  return null;
end;
$$;
create trigger addenda_qoyod after update of status, paid_amount on public.addenda
  for each row execute function private.qoyod_on_addendum();

create or replace function private.qoyod_on_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'recorded' and (tg_op = 'INSERT' or old.status <> 'recorded') and new.total > 0 then
    perform private.qoyod_enqueue(new.organization_id, 'bill', 'purchase', new.id, 'po:' || new.id);
  end if;
  return null;
end;
$$;
create trigger purchases_qoyod after insert or update of status on public.purchases
  for each row execute function private.qoyod_on_purchase();

-- Send older records (from a date) once the account is connected.
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

  select count(*) into v_after from public.qoyod_sync_jobs where organization_id = p_org;
  return v_after - v_before;
end;
$$;
revoke all on function public.qoyod_backfill(uuid, date) from public, anon;
grant execute on function public.qoyod_backfill(uuid, date) to authenticated, service_role;

-- The server job takes a batch (invoices before their payments; stuck jobs come back after 10 min).
create or replace function public.qoyod_claim_jobs(p_limit int)
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
    order by case q.kind when 'customer' then 0 when 'vendor' then 0 when 'invoice' then 1 when 'bill' then 1 else 2 end, q.created_at
    limit least(greatest(p_limit, 1), 50)
    for update of q skip locked)
  returning j.*)
  select * from claimed c
  order by case c.kind when 'customer' then 0 when 'vendor' then 0 when 'invoice' then 1 when 'bill' then 1 else 2 end, c.created_at;
end;
$$;
revoke all on function public.qoyod_claim_jobs(int) from public, anon, authenticated;
grant execute on function public.qoyod_claim_jobs(int) to service_role;

-- Retry a failed job (finance), or all failed ones.
create or replace function public.qoyod_retry(p_org uuid, p_job uuid default null)
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
  update public.qoyod_sync_jobs set status = 'queued', attempts = 0, next_attempt_at = now(), last_error = null
  where organization_id = p_org and status = 'failed' and (p_job is null or id = p_job);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.qoyod_retry(uuid, uuid) from public, anon;
grant execute on function public.qoyod_retry(uuid, uuid) to authenticated, service_role;

-- Client page: which of this contract's payments / addenda have an official invoice.
create or replace function public.portal_invoices(p_number text, p_token text)
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
  return jsonb_build_object('org', v_link.organization_id, 'items', coalesce((
    select jsonb_agg(x) from (
      select jsonb_build_object('key', 'p' || p.seq, 'qoyod_id', j.qoyod_id) as x
      from public.contract_payments p
      join public.qoyod_sync_jobs j on j.entity_id = p.id and j.kind = 'invoice' and j.status = 'done' and j.qoyod_id is not null
      where p.contract_id = v_link.contract_id
      union all
      select jsonb_build_object('key', a.number, 'qoyod_id', j.qoyod_id)
      from public.addenda a
      join public.qoyod_sync_jobs j on j.entity_id = a.id and j.kind = 'invoice' and j.status = 'done' and j.qoyod_id is not null
      where a.contract_id = v_link.contract_id
    ) s), '[]'::jsonb));
end;
$$;
revoke all on function public.portal_invoices(text, text) from public, anon, authenticated;
grant execute on function public.portal_invoices(text, text) to service_role;

-- RLS -----------------------------------------------------------------------------
alter table public.qoyod_settings enable row level security;
alter table public.qoyod_sync_jobs enable row level security;

create policy qoyod_settings_select on public.qoyod_settings for select to authenticated
  using ((select private.has_permission(organization_id, 'settings.manage')) or (select private.has_permission(organization_id, 'finance.view')));
create policy qoyod_settings_insert on public.qoyod_settings for insert to authenticated
  with check ((select private.has_permission(organization_id, 'settings.manage')));
create policy qoyod_settings_update on public.qoyod_settings for update to authenticated
  using ((select private.has_permission(organization_id, 'settings.manage')))
  with check ((select private.has_permission(organization_id, 'settings.manage')));

create policy qoyod_sync_jobs_select on public.qoyod_sync_jobs for select to authenticated
  using ((select private.has_permission(organization_id, 'finance.view')) or (select private.has_permission(organization_id, 'settings.manage')));

revoke all on public.qoyod_settings, public.qoyod_sync_jobs from anon, authenticated;
grant select on public.qoyod_settings, public.qoyod_sync_jobs to authenticated;
grant insert (organization_id, enabled, invoice_status, inventory_id, receive_account_id, expense_account_id, service_products, addendum_product_id)
  on public.qoyod_settings to authenticated;
grant update (enabled, invoice_status, inventory_id, receive_account_id, expense_account_id, service_products, addendum_product_id, updated_by)
  on public.qoyod_settings to authenticated;
grant all on public.qoyod_settings, public.qoyod_sync_jobs to service_role;
