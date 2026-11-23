-- =============================================================================
-- Editable contract clauses (owner, Nov 2026)
--   contract_templates: the company's clause settings (hide / rename / replace
--     text / extra clauses), copied into every new contract.
--   contracts.terms: that copy, editable per contract until the client accepts;
--     frozen afterwards (part of what the client signed).
-- =============================================================================

create table public.contract_templates (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  terms jsonb not null default '{}'::jsonb check (jsonb_typeof(terms) = 'object' and pg_column_size(terms) < 131072),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create trigger contract_templates_updated_at before update on public.contract_templates for each row execute function private.set_updated_at();
select private.enable_audit('public.contract_templates');

alter table public.contracts
  add column if not exists terms jsonb not null default '{}'::jsonb
  check (jsonb_typeof(terms) = 'object' and pg_column_size(terms) < 131072);

-- Same guard as before, with the clauses frozen after acceptance too.
create or replace function private.guard_contract()
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
    if new.status not in ('draft', 'sent') or new.accepted_at is not null or new.accepted_name is not null
       or new.accepted_ip is not null or new.accepted_user_agent is not null or new.accepted_signature is not null then
      raise exception 'only the client can accept' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.status = 'accepted' and (
    new.total is distinct from old.total or new.start_date is distinct from old.start_date
    or new.project_type is distinct from old.project_type or new.quote_version is distinct from old.quote_version
    or new.warranty_months is distinct from old.warranty_months or new.duration_days is distinct from old.duration_days
    or new.quote_id is distinct from old.quote_id or new.client_id is distinct from old.client_id
    or new.service is distinct from old.service or new.notes is distinct from old.notes
    or new.terms is distinct from old.terms
  ) then
    raise exception 'an accepted contract cannot change' using errcode = '42501';
  end if;
  if new.accepted_at is distinct from old.accepted_at or new.accepted_name is distinct from old.accepted_name
     or new.accepted_ip is distinct from old.accepted_ip or new.accepted_signature is distinct from old.accepted_signature
     or new.accepted_user_agent is distinct from old.accepted_user_agent
     or (new.status = 'accepted' and old.status <> 'accepted') then
    raise exception 'only the client can accept' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Client page: the clauses of this contract (token checked).
create or replace function public.portal_contract_terms(p_number text, p_token text)
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
  return (select terms from public.contracts where id = v_link.contract_id);
end;
$$;
revoke all on function public.portal_contract_terms(text, text) from public, anon, authenticated;
grant execute on function public.portal_contract_terms(text, text) to service_role;

alter table public.contract_templates enable row level security;
create policy contract_templates_select on public.contract_templates for select to authenticated
  using ((select private.has_permission(organization_id, 'quotes.view')));
create policy contract_templates_insert on public.contract_templates for insert to authenticated
  with check ((select private.has_permission(organization_id, 'settings.manage')));
create policy contract_templates_update on public.contract_templates for update to authenticated
  using ((select private.has_permission(organization_id, 'settings.manage')))
  with check ((select private.has_permission(organization_id, 'settings.manage')));
revoke all on public.contract_templates from anon, authenticated;
grant select, insert, update on public.contract_templates to authenticated;
grant all on public.contract_templates to service_role;
