-- =============================================================================
-- Deleting a success partner — the owner only (owner, Nov 2026)
-- =============================================================================
-- Users have no DELETE on public.marketers (never had). public.delete_marketer (definer) lets the
-- organization's active owner delete a partner that nothing financial points at — no quote, priced
-- version, contract, reward or voucher (a partner added by mistake). One that has any of these
-- stays: «إيقاف» (is_active = false) is the way out for him, his history keeps its name.
-- Clients that named him («جاء عن طريق» — a tag, not a record) lose the link; his page links go
-- with him (on delete cascade). Every row is audited by the tables' audit triggers, under the owner.
-- The partner row is locked FOR UPDATE before the checks, so a quote priced with him at the same
-- moment either waits and is refused (the row is gone) or is seen by the checks.

create or replace function public.delete_marketer(p_marketer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select m.organization_id into v_org from public.marketers m where m.id = p_marketer for update;
  if v_org is null or not private.is_owner(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.quotes q where q.marketer_id = p_marketer)
     or exists (select 1 from public.quote_version_costs c where c.marketer_id = p_marketer)
     or exists (select 1 from public.contracts c where c.marketer_id = p_marketer)
     or exists (select 1 from public.marketer_commissions k where k.marketer_id = p_marketer)
     or exists (select 1 from public.commission_payments p where p.marketer_id = p_marketer) then
    raise exception 'partner has records' using errcode = 'P0001';
  end if;
  update public.clients c set marketer_id = null where c.marketer_id = p_marketer;
  delete from public.marketers m where m.id = p_marketer;
end;
$$;
revoke all on function public.delete_marketer(uuid) from public, anon;
grant execute on function public.delete_marketer(uuid) to authenticated;
