-- =============================================================================
-- Phase 11 — Warranty & maintenance requests (§3.13) + messages to clients
--   Warranty runs from the final handover (client-confirmed final stage) for
--   contracts.warranty_months. During it the client opens maintenance requests
--   from their page (MR- numbers, photos); staff track status, cost and reply;
--   the client confirms the fix.
--   client_messages: WhatsApp outbox to clients (receipt issued, request fixed),
--   service role only; sent once the WhatsApp Business account is connected.
-- =============================================================================

-- Warranty -------------------------------------------------------------------------
create or replace function private.handover_at(p_contract uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(confirmed_at) from public.project_stages where contract_id = p_contract and is_final and status = 'confirmed';
$$;

create or replace function private.warranty_end(p_contract uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select ((private.handover_at(p_contract) at time zone 'Asia/Riyadh')::date + make_interval(months => c.warranty_months))::date
  from public.contracts c where c.id = p_contract;
$$;
revoke all on function private.handover_at(uuid), private.warranty_end(uuid) from public;

-- The client page stays open until the warranty really ends (handover may come later than planned).
create or replace function private.extend_link_on_handover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_end date;
begin
  if new.is_final and new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    v_end := private.warranty_end(new.contract_id);
    if v_end is not null then
      update public.client_portal_links
      set expires_at = greatest(expires_at, ((v_end + 1)::timestamp at time zone 'Asia/Riyadh'))
      where contract_id = new.contract_id and revoked_at is null;
    end if;
  end if;
  return null;
end;
$$;
create trigger project_stages_extend_link after update of status on public.project_stages
  for each row execute function private.extend_link_on_handover();

-- Messages to clients (WhatsApp outbox) ------------------------------------------------
create table public.client_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{8,15}$'),
  kind text not null check (kind in ('receipt', 'maintenance_done')),
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object' and pg_column_size(params) < 4096),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts int not null default 0,
  last_error text check (char_length(last_error) <= 300),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index client_messages_queue_idx on public.client_messages (status, created_at) where status = 'queued';
alter table public.client_messages enable row level security;
revoke all on public.client_messages from anon, authenticated;
grant all on public.client_messages to service_role;

create or replace function private.message_client(p_contract uuid, p_kind text, p_params jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_phone text;
  v_name text;
  v_number text;
begin
  select c.organization_id, cl.phone, cl.name, c.number into v_org, v_phone, v_name, v_number
  from public.contracts c join public.clients cl on cl.id = c.client_id where c.id = p_contract;
  if v_phone is null or v_phone !~ '^[0-9]{8,15}$' then
    return;
  end if;
  insert into public.client_messages (organization_id, contract_id, phone, kind, params)
  values (v_org, p_contract, v_phone, p_kind, coalesce(p_params, '{}'::jsonb) || jsonb_build_object('name', v_name, 'contract', v_number));
end;
$$;
revoke all on function private.message_client(uuid, text, jsonb) from public;

create or replace function private.message_on_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.message_client(new.contract_id, 'receipt', jsonb_build_object('number', new.number, 'amount', new.amount, 'label', new.label));
  return null;
end;
$$;
create trigger client_receipts_message after insert on public.client_receipts for each row execute function private.message_on_receipt();

-- Maintenance requests ---------------------------------------------------------------
create table public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null,
  contract_id uuid not null references public.contracts (id) on delete restrict,
  body text not null check (char_length(body) between 1 and 2000),
  photos text[] not null default '{}' check (cardinality(photos) <= 6),
  source text not null default 'client' check (source in ('client', 'staff')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed', 'rejected')),
  assigned_to uuid references auth.users (id) on delete set null,
  covered boolean not null default true,
  cost numeric(12, 2) not null default 0 check (cost >= 0),
  reply text check (char_length(reply) <= 1000),
  internal_note text check (char_length(internal_note) <= 2000),
  resolved_at timestamptz,
  closed_at timestamptz,
  client_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, number)
);
create index maintenance_requests_org_idx on public.maintenance_requests (organization_id, status, created_at desc);
create index maintenance_requests_contract_idx on public.maintenance_requests (contract_id);

create trigger maintenance_requests_number before insert on public.maintenance_requests for each row execute function private.assign_document_number('maintenance');
create trigger maintenance_requests_lock_number before update of number on public.maintenance_requests for each row execute function private.lock_number();
create trigger maintenance_requests_updated_at before update on public.maintenance_requests for each row execute function private.set_updated_at();
create trigger maintenance_requests_created_by before insert on public.maintenance_requests for each row execute function private.set_created_by();
select private.enable_audit('public.maintenance_requests');

-- Staff: the client's words and photos never change; the request must belong to an accepted contract
-- of the same organization; the assignee must be a member. Status timestamps are stamped here.
-- security invoker: the checks must see the real caller.
create or replace function private.guard_maintenance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if tg_op = 'INSERT' then
    select organization_id into v_org from public.contracts where id = new.contract_id and status = 'accepted';
    if v_org is distinct from new.organization_id then
      raise exception 'contract not found' using errcode = '42501';
    end if;
    if current_user in ('authenticated', 'anon') then
      new.source := 'staff';
      new.status := 'open';
      new.client_confirmed_at := null;
      new.resolved_at := null;
      new.closed_at := null;
    end if;
  elsif current_user in ('authenticated', 'anon') then
    if new.contract_id is distinct from old.contract_id or new.body is distinct from old.body or new.photos is distinct from old.photos
       or new.source is distinct from old.source or new.client_confirmed_at is distinct from old.client_confirmed_at
       or new.organization_id is distinct from old.organization_id then
      raise exception 'the request itself can''t change' using errcode = '42501';
    end if;
  end if;
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists (select 1 from public.memberships m where m.organization_id = new.organization_id and m.user_id = new.assigned_to and m.status = 'active') then
    raise exception 'assignee is not a member' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'resolved' then
      new.resolved_at := now();
    elsif new.status in ('closed', 'rejected') then
      new.closed_at := now();
    elsif new.status in ('open', 'in_progress') then
      new.resolved_at := null;
      new.closed_at := null;
    end if;
  end if;
  return new;
end;
$$;
create trigger maintenance_requests_guard before insert or update on public.maintenance_requests for each row execute function private.guard_maintenance();

-- Notifications: new kind -------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted',
  'payment_received', 'payment_late', 'doc_expiry', 'approval_reminder', 'maintenance_request'));
alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check check (kind in ('approval', 'client_note', 'stage_confirmed', 'contract_accepted', 'addendum_accepted',
  'payment_received', 'payment_late', 'doc_expiry', 'approval_reminder', 'maintenance_request'));

create or replace function private.maintenance_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract text;
begin
  select number into v_contract from public.contracts where id = new.contract_id;
  if tg_op = 'INSERT' and new.source = 'client' then
    perform private.notify(new.organization_id, 'projects.manage', 'maintenance_request',
      jsonb_build_object('number', new.number, 'contract', v_contract, 'body', left(new.body, 120)), '/maintenance?r=' || new.number, 'mr:' || new.id);
  end if;
  if tg_op = 'UPDATE' and new.status = 'resolved' and old.status is distinct from 'resolved' then
    perform private.message_client(new.contract_id, 'maintenance_done', jsonb_build_object('number', new.number, 'reply', left(coalesce(new.reply, ''), 200)));
  end if;
  return null;
end;
$$;
create trigger maintenance_requests_events after insert or update of status on public.maintenance_requests
  for each row execute function private.maintenance_events();

-- Client page ----------------------------------------------------------------------
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
        'reply', m.reply, 'created_at', m.created_at, 'resolved_at', m.resolved_at, 'client_confirmed_at', m.client_confirmed_at) order by m.created_at desc)
      from public.maintenance_requests m where m.contract_id = v_link.contract_id), '[]'::jsonb));
end;
$$;
revoke all on function public.portal_warranty(text, text) from public, anon, authenticated;
grant execute on function public.portal_warranty(text, text) to service_role;

create or replace function public.portal_add_maintenance(p_number text, p_token text, p_body text, p_photos text[])
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
  v_end date;
  v_number text;
begin
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null then
    return null;
  end if;
  v_end := private.warranty_end(v_link.contract_id);
  if v_end is null or (now() at time zone 'Asia/Riyadh')::date > v_end then
    raise exception 'not under warranty' using errcode = '22023';
  end if;
  if p_body is null or char_length(trim(p_body)) < 1 or char_length(p_body) > 2000 or cardinality(coalesce(p_photos, '{}')) > 6 then
    raise exception 'invalid request' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_photos, '{}')) ph
             where ph !~ ('^' || v_link.organization_id::text || '/' || v_link.contract_id::text || '/client/[0-9a-f-]{36}\.jpg$')) then
    raise exception 'invalid photo path' using errcode = '22023';
  end if;
  if (select count(*) from public.maintenance_requests where contract_id = v_link.contract_id and status in ('open', 'in_progress')) >= 10 then
    raise exception 'too many open requests' using errcode = '22023';
  end if;
  insert into public.maintenance_requests (organization_id, contract_id, body, photos, source)
  values (v_link.organization_id, v_link.contract_id, trim(p_body), coalesce(p_photos, '{}'), 'client')
  returning number into v_number;
  return v_number;
end;
$$;
revoke all on function public.portal_add_maintenance(text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.portal_add_maintenance(text, text, text, text[]) to service_role;

create or replace function public.portal_confirm_maintenance(p_number text, p_token text, p_request uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
begin
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null then
    return false;
  end if;
  update public.maintenance_requests set status = 'closed', client_confirmed_at = now()
  where id = p_request and contract_id = v_link.contract_id and status = 'resolved';
  return found;
end;
$$;
revoke all on function public.portal_confirm_maintenance(text, text, uuid) from public, anon, authenticated;
grant execute on function public.portal_confirm_maintenance(text, text, uuid) to service_role;

-- Staff list: warranty end per contract (projects.view).
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
    and private.handover_at(c.id) is not null;
$$;
revoke all on function public.contract_warranties(uuid) from public, anon;
grant execute on function public.contract_warranties(uuid) to authenticated, service_role;

-- RLS -----------------------------------------------------------------------------
alter table public.maintenance_requests enable row level security;
create policy maintenance_requests_select on public.maintenance_requests for select to authenticated
  using ((select private.has_permission(organization_id, 'projects.view')));
create policy maintenance_requests_insert on public.maintenance_requests for insert to authenticated
  with check ((select private.has_permission(organization_id, 'projects.manage')));
create policy maintenance_requests_update on public.maintenance_requests for update to authenticated
  using ((select private.has_permission(organization_id, 'projects.manage')))
  with check ((select private.has_permission(organization_id, 'projects.manage')));
revoke all on public.maintenance_requests from anon, authenticated;
grant select on public.maintenance_requests to authenticated;
grant insert (organization_id, contract_id, body, assigned_to, covered, cost, reply, internal_note) on public.maintenance_requests to authenticated;
grant update (status, assigned_to, covered, cost, reply, internal_note) on public.maintenance_requests to authenticated;
grant all on public.maintenance_requests to service_role;
