-- =============================================================================
-- Phase 7 — Execution follow-up (§3.12, §3.14)
--   project_stages: the contract's stages (copied from the service's stages
--     when the client accepts), progress %, the report sent to the client,
--     the client's confirmation; the last stage is the final handover
--     (e-signed certificate). A confirmed stage marks its payment "requested".
--   site_visits: supervisor check-in with GPS + server time (proof of visit).
--   progress_updates: progress % + photos (private bucket project-photos).
--   client_notes: notes + photos the client posts from the client page.
--   Read: projects.view · write: projects.manage. The client acts only
--   through service-role functions behind the server's rate limiting.
-- =============================================================================

create table public.project_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  seq int not null check (seq between 1 and 50),
  name text not null check (char_length(name) between 2 and 120),
  payment_event text check (payment_event in ('signing', 'material_supply', 'board_closing', 'primer_done', 'handover', 'custom')),
  is_final boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'awaiting_client', 'confirmed')),
  progress int not null default 0 check (progress between 0 and 100),
  report text check (char_length(report) <= 4000),
  report_ai boolean not null default false,
  sent_at timestamptz,
  confirmed_at timestamptz,
  confirmed_name text check (char_length(confirmed_name) <= 160),
  confirmed_ip text check (char_length(confirmed_ip) <= 64),
  confirmed_user_agent text check (char_length(confirmed_user_agent) <= 400),
  confirmed_signature text check (char_length(confirmed_signature) <= 200000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (contract_id, seq)
);
create index project_stages_contract_idx on public.project_stages (contract_id, seq);

create table public.site_visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  accuracy_m numeric(8, 1) check (accuracy_m >= 0),
  note text check (char_length(note) <= 500),
  -- the time is the server's, never the phone's
  checked_in_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  check ((latitude is null) = (longitude is null))
);
create index site_visits_contract_idx on public.site_visits (contract_id, checked_in_at desc);

create table public.progress_updates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  stage_id uuid not null references public.project_stages (id) on delete cascade,
  progress int not null check (progress between 0 and 100),
  note text check (char_length(note) <= 1000),
  photos text[] not null default '{}' check (cardinality(photos) <= 12),
  visible_to_client boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index progress_updates_stage_idx on public.progress_updates (stage_id, created_at desc);

create table public.client_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  stage_id uuid references public.project_stages (id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  photos text[] not null default '{}' check (cardinality(photos) <= 6),
  status text not null default 'new' check (status in ('new', 'seen', 'resolved')),
  reply text check (char_length(reply) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index client_notes_contract_idx on public.client_notes (contract_id, created_at desc);

-- Triggers ------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['project_stages', 'client_notes'] loop
    execute format('create trigger %1$s_updated_at before update on public.%1$s for each row execute function private.set_updated_at()', t);
  end loop;
  foreach t in array array['project_stages', 'site_visits', 'progress_updates', 'client_notes'] loop
    execute format('create trigger %1$s_created_by before insert on public.%1$s for each row execute function private.set_created_by()', t);
    execute format('select private.enable_audit(%L)', 'public.' || t);
  end loop;
end $$;

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
revoke all on function private.check_phase7_refs() from public;
grant execute on function private.check_phase7_refs() to authenticated, service_role;
do $$
declare t text;
begin
  foreach t in array array['project_stages', 'site_visits', 'progress_updates', 'client_notes'] loop
    execute format('create trigger %1$s_refs before insert or update on public.%1$s for each row execute function private.check_phase7_refs()', t);
  end loop;
end $$;

-- Staff can't fake the client's confirmation, and work starts only on an accepted contract.
create or replace function private.guard_stage()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.status in ('awaiting_client', 'confirmed') or new.confirmed_at is not null then
        raise exception 'only the client can confirm' using errcode = '42501';
      end if;
    else
      if new.status = 'confirmed' and old.status <> 'confirmed'
         or new.confirmed_at is distinct from old.confirmed_at or new.confirmed_name is distinct from old.confirmed_name
         or new.confirmed_signature is distinct from old.confirmed_signature or new.confirmed_ip is distinct from old.confirmed_ip then
        raise exception 'only the client can confirm' using errcode = '42501';
      end if;
      if old.status = 'confirmed' and (new.status <> 'confirmed' or new.report is distinct from old.report or new.name is distinct from old.name or new.progress is distinct from old.progress) then
        raise exception 'a confirmed stage can''t change' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger project_stages_guard before insert or update on public.project_stages for each row execute function private.guard_stage();

create or replace function private.require_accepted_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.contracts c where c.id = new.contract_id and c.status = 'accepted') then
    raise exception 'work starts after the client accepts the contract' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger site_visits_accepted before insert on public.site_visits for each row execute function private.require_accepted_contract();

-- proof of visit: the check-in time is always the database's clock
create or replace function private.stamp_visit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.checked_in_at := now();
  return new;
end;
$$;
create trigger site_visits_stamp before insert or update on public.site_visits for each row execute function private.stamp_visit();
create trigger progress_updates_accepted before insert on public.progress_updates for each row execute function private.require_accepted_contract();

-- Stages for a contract, from the service's stage list (or sensible defaults).
create or replace function private.create_project_stages(p_contract uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.contracts;
  v_code text;
  v_n int;
begin
  select * into c from public.contracts where id = p_contract;
  if c.id is null or exists (select 1 from public.project_stages where contract_id = p_contract) then
    return;
  end if;
  v_code := case c.service when 'gypsum' then 'gypsum' when 'interior' then 'interior-paint' else 'exterior-paint' end;
  insert into public.project_stages (organization_id, contract_id, seq, name, payment_event, is_final)
  select c.organization_id, p_contract, row_number() over (order by ss.sort_order, ss.created_at), ss.name_ar,
         case
           when ss.kind = 'handover' then 'handover'
           when c.service = 'gypsum' and ss.name_ar like '%الألواح%' then 'board_closing'
           when ss.name_ar like '%الأساس%' then 'primer_done'
         end,
         false
  from public.service_stages ss
  join public.services s on s.id = ss.service_id
  where s.organization_id = c.organization_id and s.code = v_code;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    insert into public.project_stages (organization_id, contract_id, seq, name, payment_event)
    select c.organization_id, p_contract, d.seq, d.name, d.ev
    from (values (1, 'تجهيز الموقع', null::text), (2, 'التنفيذ', null), (3, 'التشطيب', null), (4, 'التنظيف والتسليم', 'handover')) as d(seq, name, ev);
  end if;
  -- the last stage is always the final handover (certificate)
  update public.project_stages set is_final = true, payment_event = coalesce(payment_event, 'handover')
  where contract_id = p_contract and seq = (select max(seq) from public.project_stages where contract_id = p_contract);
end;
$$;
revoke all on function private.create_project_stages(uuid) from public;

create or replace function private.on_contract_accepted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    perform private.create_project_stages(new.id);
  end if;
  return new;
end;
$$;
create trigger contracts_create_stages after update of status on public.contracts for each row execute function private.on_contract_accepted();

-- contracts already accepted before this migration get their stages now
select private.create_project_stages(id) from public.contracts where status = 'accepted';

-- RLS -----------------------------------------------------------------------------
alter table public.project_stages enable row level security;
alter table public.site_visits enable row level security;
alter table public.progress_updates enable row level security;
alter table public.client_notes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['project_stages', 'site_visits', 'progress_updates', 'client_notes'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using ((select private.has_permission(organization_id, 'projects.view')));
    $f$, t);
  end loop;
  foreach t in array array['project_stages', 'site_visits', 'progress_updates'] loop
    execute format($f$
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check ((select private.has_permission(organization_id, 'projects.manage')));
    $f$, t);
  end loop;
  foreach t in array array['project_stages', 'client_notes'] loop
    execute format($f$
      create policy %1$s_update on public.%1$s for update to authenticated
        using ((select private.has_permission(organization_id, 'projects.manage')))
        with check ((select private.has_permission(organization_id, 'projects.manage')));
    $f$, t);
  end loop;
end $$;

revoke all on public.project_stages, public.site_visits, public.progress_updates, public.client_notes from anon;
grant select, insert, update on public.project_stages to authenticated;
grant select, insert on public.site_visits, public.progress_updates to authenticated;
grant select, update on public.client_notes to authenticated;
grant all on public.project_stages, public.site_visits, public.progress_updates, public.client_notes to service_role;

-- Client notes can only change status/reply from the staff side.
create or replace function private.guard_client_note()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and (new.body is distinct from old.body or new.photos is distinct from old.photos
     or new.contract_id is distinct from old.contract_id or new.stage_id is distinct from old.stage_id) then
    raise exception 'the client''s note can''t be edited' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger client_notes_guard before update on public.client_notes for each row execute function private.guard_client_note();

-- Private bucket for site photos: <org>/<contract>/<uuid>.jpg (staff) and
-- <org>/<contract>/client/<uuid>.jpg (uploaded by the server for the client).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-photos', 'project-photos', false, 4194304, array['image/jpeg'])
on conflict (id) do nothing;
create policy project_photos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'project-photos' and (select private.has_permission(private.storage_object_org(name), 'projects.view')));
create policy project_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-photos' and (select private.has_permission(private.storage_object_org(name), 'projects.manage'))
              and name !~ '/client/');

-- Client page: stages, visible progress photos and the client's own notes.
create or replace function public.portal_execution(p_number text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 100 or p_number is null or char_length(p_number) > 30 then
    return null;
  end if;
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'seq', s.seq, 'name', s.name, 'status', s.status, 'progress', s.progress, 'is_final', s.is_final,
        'report', case when s.status in ('awaiting_client', 'confirmed') then s.report end,
        'sent_at', s.sent_at, 'confirmed_at', s.confirmed_at, 'confirmed_name', s.confirmed_name,
        'photos', coalesce((select jsonb_agg(ph order by ph) from (
            select unnest(u.photos) as ph from public.progress_updates u
            where u.stage_id = s.id and u.visible_to_client order by u.created_at desc limit 4) x), '[]'::jsonb)
      ) order by s.seq)
      from public.project_stages s where s.contract_id = v_link.contract_id), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'photos', n.photos, 'status', n.status, 'reply', n.reply,
                                          'stage_id', n.stage_id, 'created_at', n.created_at) order by n.created_at desc)
      from public.client_notes n where n.contract_id = v_link.contract_id), '[]'::jsonb),
    'org_id', (select organization_id from public.contracts where id = v_link.contract_id),
    'contract_id', v_link.contract_id
  );
end;
$$;
revoke all on function public.portal_execution(text, text) from public, anon, authenticated;
grant execute on function public.portal_execution(text, text) to service_role;

-- Client confirms a stage it was sent; the final stage needs a signature (certificate).
create or replace function public.portal_confirm_stage(p_number text, p_token text, p_stage uuid, p_name text, p_signature text, p_ip text, p_user_agent text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
  s public.project_stages;
begin
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null then
    return false;
  end if;
  if p_name is null or char_length(trim(p_name)) < 2 or char_length(p_name) > 160 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  if p_signature is not null and (char_length(p_signature) > 200000 or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$') then
    raise exception 'invalid signature' using errcode = '22023';
  end if;
  select * into s from public.project_stages where id = p_stage and contract_id = v_link.contract_id for update;
  if s.id is null or s.status <> 'awaiting_client' then
    return false;
  end if;
  if s.is_final and p_signature is null then
    raise exception 'the final handover needs a signature' using errcode = '22023';
  end if;
  update public.project_stages
  set status = 'confirmed', progress = 100, confirmed_at = now(), confirmed_name = trim(p_name),
      confirmed_ip = left(p_ip, 64), confirmed_user_agent = left(p_user_agent, 400), confirmed_signature = p_signature
  where id = s.id;
  -- §3.7: a stage done → its payment is requested
  if s.payment_event is not null then
    update public.contract_payments set status = 'requested'
    where contract_id = v_link.contract_id and due_event = s.payment_event and status = 'pending';
  end if;
  return true;
end;
$$;
revoke all on function public.portal_confirm_stage(text, text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.portal_confirm_stage(text, text, uuid, text, text, text, text) to service_role;

-- Client posts a note (photos already uploaded by the server under .../client/).
create or replace function public.portal_add_note(p_number text, p_token text, p_stage uuid, p_body text, p_photos text[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.client_portal_links;
  v_org uuid;
  v_id uuid;
begin
  v_link := private.portal_link(p_number, p_token);
  if v_link.id is null then
    return null;
  end if;
  select organization_id into v_org from public.contracts where id = v_link.contract_id and status = 'accepted';
  if v_org is null then
    return null;
  end if;
  if p_body is null or char_length(trim(p_body)) < 1 or char_length(p_body) > 2000 or cardinality(coalesce(p_photos, '{}')) > 6 then
    raise exception 'invalid note' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_photos, '{}')) ph where ph !~ ('^' || v_org::text || '/' || v_link.contract_id::text || '/client/[0-9a-f-]{36}\.jpg$')) then
    raise exception 'invalid photo path' using errcode = '22023';
  end if;
  if p_stage is not null and not exists (select 1 from public.project_stages where id = p_stage and contract_id = v_link.contract_id) then
    p_stage := null;
  end if;
  insert into public.client_notes (organization_id, contract_id, stage_id, body, photos)
  values (v_org, v_link.contract_id, p_stage, trim(p_body), coalesce(p_photos, '{}'))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.portal_add_note(text, text, uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.portal_add_note(text, text, uuid, text, text[]) to service_role;
