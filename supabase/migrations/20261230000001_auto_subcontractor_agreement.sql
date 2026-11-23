-- =============================================================================
-- Book a subcontractor's team on a project → his agreement is ready (owner, Nov 2026)
--   No re-entering price and area: the agreement takes
--     • the rate the quote was priced with (quote labour = this contractor's rate),
--       else his active rate for the contract's work,
--     • the area from the accepted quote (sum of its work types, m²).
--   Created once per (subcontractor, contract), once the client has accepted;
--   the owner can still edit it.
--   Existing bookings get their agreement now.
-- =============================================================================

create or replace function private.ensure_subcontractor_agreement(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.schedule_entries;
  v_sub uuid;
  c public.contracts;
  v_sel jsonb;
  v_view jsonb;
  v_rate public.labour_rates;
  v_area numeric;
  v_scope text;
begin
  select * into e from public.schedule_entries where id = p_entry;
  if e.id is null or e.kind <> 'work' or e.contract_id is null then
    return;
  end if;
  select subcontractor_id into v_sub from public.teams where id = e.team_id;
  if v_sub is null then
    return;
  end if;
  if exists (select 1 from public.subcontractor_agreements a where a.subcontractor_id = v_sub and a.contract_id = e.contract_id) then
    return;
  end if;
  select * into c from public.contracts where id = e.contract_id;
  -- only once the client has accepted (the chosen option fixes the price and area)
  if c.status <> 'accepted' then
    return;
  end if;
  select qv.selection, qv.client_view into v_sel, v_view from public.quote_versions qv where qv.quote_id = c.quote_id and qv.version = c.quote_version;

  -- the rate the quote used, when it is this contractor's
  if v_sel -> 'labour' ->> 'source' = 'external' and (v_sel -> 'labour' ->> 'externalId') ~ '^[0-9a-f-]{36}$' then
    select * into v_rate from public.labour_rates
    where id = (v_sel -> 'labour' ->> 'externalId')::uuid and subcontractor_id = v_sub;
  end if;
  -- else his active rate for this kind of work, else any active rate of his
  if v_rate.id is null then
    select * into v_rate from public.labour_rates l
    where l.subcontractor_id = v_sub and l.is_active
    order by (private.service_kind(l.service_id) = c.service) desc nulls last, l.created_at
    limit 1;
  end if;
  if v_rate.id is null then
    return;  -- no price known: the owner sets the agreement by hand
  end if;

  select coalesce(sum((w ->> 'area')::numeric), 0) into v_area
  from jsonb_array_elements(coalesce(v_view -> 'workTypes', '[]'::jsonb)) w;
  if v_rate.basis = 'external_per_unit' and v_area <= 0 then
    return;
  end if;
  v_scope := case c.service when 'gypsum' then 'أعمال الجبس' when 'interior' then 'دهانات داخلية' when 'exterior' then 'دهانات خارجية' else 'أعمال' end
             || ' حسب العقد ' || c.number;

  insert into public.subcontractor_agreements (organization_id, subcontractor_id, contract_id, scope, basis, rate, quantity_m2, schedule, created_by)
  values (c.organization_id, v_sub, c.id, v_scope,
          case when v_rate.basis = 'external_per_unit' then 'per_m2' else 'lump' end,
          v_rate.rate,
          case when v_rate.basis = 'external_per_unit' then round(v_area, 2) end,
          'progress', e.created_by);
end;
$$;
revoke all on function private.ensure_subcontractor_agreement(uuid) from public;

create or replace function private.schedule_entry_agreement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_subcontractor_agreement(new.id);
  return null;
end;
$$;
create trigger schedule_entries_agreement after insert or update of team_id, contract_id, kind on public.schedule_entries
  for each row execute function private.schedule_entry_agreement();

-- A booking made before the client accepted gets its agreement on acceptance.
create or replace function private.contract_accept_agreements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    for r in select id from public.schedule_entries where contract_id = new.id and kind = 'work' order by created_at loop
      perform private.ensure_subcontractor_agreement(r.id);
    end loop;
  end if;
  return null;
end;
$$;
create trigger contracts_accept_agreements after update of status on public.contracts
  for each row execute function private.contract_accept_agreements();

-- Bookings that already exist.
do $$
declare r record;
begin
  for r in select id from public.schedule_entries where kind = 'work' and contract_id is not null order by created_at loop
    perform private.ensure_subcontractor_agreement(r.id);
  end loop;
end $$;
