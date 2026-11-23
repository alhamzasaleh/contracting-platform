-- =============================================================================
-- Per-project access (§3.17): a member whose memberships.project_scope is
-- 'assigned' sees only the projects (contracts) they are assigned to.
--   project_members: who is assigned to which contract (members.manage).
--   private.can_access_contract(): owner / scope 'all' → every project;
--     scope 'assigned' → only assigned contracts.
--   RESTRICTIVE policies on every contract-scoped table add that rule on top
--   of the existing permission policies (they can only narrow, never widen).
--   Project photos in storage follow the same rule (path <org>/<contract>/…).
--   Notifications about a project reach only members who can see it.
-- Non-destructive: existing members keep scope 'all' (nothing changes until the
-- owner switches someone to 'assigned').
-- =============================================================================

create table public.project_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  primary key (contract_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id, organization_id);
create trigger project_members_created_by before insert on public.project_members for each row execute function private.set_created_by();
select private.enable_audit('public.project_members');

-- The contract and the user must belong to the same organization.
create or replace function private.check_project_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.contracts c where c.id = new.contract_id and c.organization_id = new.organization_id)
     or not exists (select 1 from public.memberships m where m.user_id = new.user_id and m.organization_id = new.organization_id) then
    raise exception 'contract and member must belong to the organization' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger project_members_check before insert or update on public.project_members
  for each row execute function private.check_project_member();

-- Can this user (default: the caller) see this contract?
create or replace function private.member_can_access(p_org uuid, p_user uuid, p_contract uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_org and m.user_id = p_user and m.status = 'active'
      and (m.role = 'owner' or m.project_scope = 'all'
           or exists (select 1 from public.project_members pm where pm.contract_id = p_contract and pm.user_id = p_user and pm.organization_id = p_org))
  )
$$;
revoke all on function private.member_can_access(uuid, uuid, uuid) from public;

create or replace function private.can_access_contract(p_org uuid, p_contract uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.member_can_access(p_org, auth.uid(), p_contract)
$$;
revoke all on function private.can_access_contract(uuid, uuid) from public;
grant execute on function private.can_access_contract(uuid, uuid) to authenticated;

-- RLS on the assignments: members see their organization's; members.manage assigns.
alter table public.project_members enable row level security;
create policy project_members_select on public.project_members for select to authenticated
  using ((select private.is_member(organization_id)));
create policy project_members_insert on public.project_members for insert to authenticated
  with check ((select private.has_permission(organization_id, 'members.manage')));
create policy project_members_delete on public.project_members for delete to authenticated
  using ((select private.has_permission(organization_id, 'members.manage')));
revoke all on public.project_members from anon, authenticated;
grant select, insert, delete on public.project_members to authenticated;
grant all on public.project_members to service_role;

-- Restrictive project rule on the contracts and everything hanging off them.
create policy contracts_project_scope on public.contracts as restrictive for all to authenticated
  using (private.can_access_contract(organization_id, id))
  with check (private.can_access_contract(organization_id, id));

do $$
declare
  t text;
begin
  foreach t in array array['addenda', 'client_messages', 'client_notes', 'client_portal_links', 'client_receipts', 'contract_payments',
                           'inventory_movements', 'invoices', 'maintenance_requests', 'petty_cash_entries', 'progress_updates',
                           'project_stages', 'purchases', 'schedule_entries', 'site_visits', 'subcontractor_agreements'] loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (contract_id is null or private.can_access_contract(organization_id, contract_id))
         with check (contract_id is null or private.can_access_contract(organization_id, contract_id))',
      t || '_project_scope', t);
  end loop;
end $$;

-- Project photos: <org>/<contract>/<file> — same rule for reading and uploading.
create or replace function private.storage_object_contract(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when split_part(p_name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 2)::uuid end
$$;
create policy project_photos_project_scope on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'project-photos' or private.can_access_contract(private.storage_object_org(name), private.storage_object_contract(name)))
  with check (bucket_id <> 'project-photos' or private.can_access_contract(private.storage_object_org(name), private.storage_object_contract(name)));

-- Notifications about a project go only to members who can see it. The project is
-- taken from the notification's link (/contracts/C-…, /projects/C-…, /maintenance?r=MR-…).
create or replace function private.link_contract(p_org uuid, p_link text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.id from public.contracts c where c.organization_id = p_org and c.number = substring(p_link from '^/(?:contracts|projects)/([A-Z]{1,3}-[0-9]{4}-[0-9]{3,6})')),
    (select m.contract_id from public.maintenance_requests m where m.organization_id = p_org and m.number = substring(p_link from '^/maintenance\?r=([A-Z]{1,3}-[0-9]{4}-[0-9]{3,6})'))
  )
$$;
revoke all on function private.link_contract(uuid, text) from public;

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
  v_contract uuid := private.link_contract(p_org, p_link);
begin
  for m in select ms.user_id from public.memberships ms
           where ms.organization_id = p_org and ms.status = 'active' loop
    if not (p_permission = any (private.member_permissions(p_org, m.user_id))) then
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
revoke all on function private.notify(uuid, text, text, jsonb, text, text) from public;

-- Staff who manage members can see who is assigned where (for the settings screen).
grant update (project_scope) on public.memberships to authenticated;
