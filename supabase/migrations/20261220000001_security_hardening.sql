-- =============================================================================
-- Phase 12c — security review fixes (non-destructive)
--   1. Contracts can't be inserted already "accepted" by staff (only the client accepts),
--      and an accepted contract can't be re-pointed to another quote/client/service.
--   2. Contract payments can't be inserted or switched to requested/paid by staff:
--      money is recorded only through record_client_payment (and stage events).
--   3. Client-page links: staff may only revoke (never un-revoke, extend or edit).
--   4. Acceptance signatures are PNG only (new rows).
-- Guards are SECURITY INVOKER so they see the real caller.
-- =============================================================================

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
drop trigger contracts_guard on public.contracts;
create trigger contracts_guard before insert or update on public.contracts for each row execute function private.guard_contract();

create or replace function private.guard_contract_payment()
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
    if new.status <> 'pending' or new.paid_amount is not null or new.paid_at is not null or new.paid_method is not null
       or new.paid_reference is not null or new.requested_at is not null then
      raise exception 'payments are recorded through record_client_payment' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status or new.paid_amount is distinct from old.paid_amount or new.paid_at is distinct from old.paid_at
     or new.paid_method is distinct from old.paid_method or new.paid_reference is distinct from old.paid_reference
     or new.requested_at is distinct from old.requested_at then
    raise exception 'payments are recorded through record_client_payment' using errcode = '42501';
  end if;
  if exists (select 1 from public.contracts c where c.id = old.contract_id and c.status = 'accepted') and (
     new.percent is distinct from old.percent or new.amount is distinct from old.amount or new.label is distinct from old.label
     or new.due_event is distinct from old.due_event or new.seq is distinct from old.seq or new.contract_id is distinct from old.contract_id) then
    raise exception 'the payment schedule of an accepted contract can''t change' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger contract_payments_guard on public.contract_payments;
create trigger contract_payments_guard before insert or update on public.contract_payments
  for each row execute function private.guard_contract_payment();

create or replace function private.guard_portal_link()
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
    if new.revoked_at is not null or new.expires_at > now() + interval '3 years' then
      raise exception 'invalid link' using errcode = '22023';
    end if;
    return new;
  end if;
  if new.token_hash is distinct from old.token_hash or new.contract_id is distinct from old.contract_id
     or new.organization_id is distinct from old.organization_id or new.expires_at is distinct from old.expires_at
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'links can only be revoked' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger client_portal_links_guard before insert or update on public.client_portal_links
  for each row execute function private.guard_portal_link();

alter table public.contracts
  add constraint contracts_signature_png check (accepted_signature is null or accepted_signature ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$') not valid;
