-- =============================================================================
-- Phase 6 — Purchases & inventory
--   purchases (PO-YYYY-NNN): supplier invoice (photo/PDF in the private
--   bucket purchase-docs), charged to a project (contract) or to general stock.
--   purchase_lines: materials (→ inventory) or expenses (transport, rental…).
--   inventory_items: what we stock; is_general = returns to stock (boards,
--   screws, tape); project-specific items (client colours, tiles) stay on the
--   project. inventory_movements: signed quantities per location
--   (contract_id null = general stock) at cost; balances can't go negative.
--   Posting is done only by SECURITY DEFINER functions:
--     public.submit_purchase()  — records it, or raises an approval when the
--                                 total is above pricing_settings.purchase_approval_limit
--     public.move_stock()       — issue / return / transfer at average cost
--   and by the approvals trigger when the owner approves a purchase.
-- =============================================================================

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  unit text not null default 'pcs' check (char_length(unit) between 1 and 20),
  product_id uuid references public.products (id) on delete set null,
  is_general boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, name, unit)
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null,
  supplier_id uuid references public.suppliers (id) on delete set null,
  supplier_name text check (char_length(supplier_name) <= 160),
  supplier_vat text check (supplier_vat ~ '^3[0-9]{13}3$'),
  invoice_number text check (char_length(invoice_number) <= 60),
  invoice_date date,
  contract_id uuid references public.contracts (id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'recorded', 'rejected', 'cancelled')),
  subtotal numeric(14, 2) not null default 0 check (subtotal >= 0),
  vat numeric(14, 2) not null default 0 check (vat >= 0),
  total numeric(14, 2) not null default 0 check (total >= 0),
  attachment_path text check (char_length(attachment_path) <= 300),
  ai_extracted boolean not null default false,
  ai_flags jsonb not null default '{}'::jsonb check (jsonb_typeof(ai_flags) = 'object' and pg_column_size(ai_flags) < 8192),
  notes text check (char_length(notes) <= 2000),
  recorded_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, number)
);
create index purchases_org_idx on public.purchases (organization_id, created_at desc);
create index purchases_contract_idx on public.purchases (contract_id);

create table public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  seq int not null check (seq between 1 and 200),
  kind text not null default 'material' check (kind in ('material', 'expense')),
  item_id uuid references public.inventory_items (id) on delete restrict,
  description text not null check (char_length(description) between 1 and 200),
  colour text check (char_length(colour) <= 60),
  quantity numeric(14, 3) not null check (quantity > 0),
  unit text not null default 'pcs' check (char_length(unit) between 1 and 20),
  unit_price numeric(14, 4) not null check (unit_price >= 0),
  amount numeric(14, 2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (purchase_id, seq),
  check (kind = 'expense' or item_id is not null)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  contract_id uuid references public.contracts (id) on delete restrict, -- null = general stock
  kind text not null check (kind in ('purchase', 'issue', 'return', 'transfer', 'adjust')),
  quantity numeric(14, 3) not null check (quantity <> 0),
  unit_cost numeric(14, 4) not null check (unit_cost >= 0),
  purchase_line_id uuid references public.purchase_lines (id) on delete restrict,
  transfer_group uuid,
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index inventory_movements_loc_idx on public.inventory_movements (organization_id, item_id, contract_id);
create index inventory_movements_contract_idx on public.inventory_movements (contract_id);

-- Triggers ------------------------------------------------------------------------
create trigger purchases_number before insert on public.purchases for each row execute function private.assign_document_number('purchase');
create trigger purchases_lock_number before update of number on public.purchases for each row execute function private.lock_number();
do $$
declare t text;
begin
  foreach t in array array['inventory_items', 'purchases'] loop
    execute format('create trigger %1$s_updated_at before update on public.%1$s for each row execute function private.set_updated_at()', t);
  end loop;
  foreach t in array array['inventory_items', 'purchases', 'purchase_lines', 'inventory_movements'] loop
    execute format('create trigger %1$s_created_by before insert on public.%1$s for each row execute function private.set_created_by()', t);
    execute format('select private.enable_audit(%L)', 'public.' || t);
  end loop;
end $$;

create or replace function private.check_phase6_refs()
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
  for ref in select * from (values ('supplier_id', 'suppliers'), ('contract_id', 'contracts'), ('purchase_id', 'purchases'),
                                   ('item_id', 'inventory_items'), ('product_id', 'products'), ('purchase_line_id', 'purchase_lines')) as r(col, tbl) loop
    if j ? ref.col and j ->> ref.col is not null then
      execute format('select organization_id from public.%I where id = $1', ref.tbl) into v_org using (j ->> ref.col)::uuid;
      if v_org is distinct from new.organization_id then
        raise exception '% belongs to another organization', ref.col using errcode = '42501';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.check_phase6_refs() from public;
grant execute on function private.check_phase6_refs() to authenticated, service_role;
do $$
declare t text;
begin
  foreach t in array array['inventory_items', 'purchases', 'purchase_lines', 'inventory_movements'] loop
    execute format('create trigger %1$s_refs before insert or update on public.%1$s for each row execute function private.check_phase6_refs()', t);
  end loop;
end $$;

-- Only drafts (and rejected ones being reworked) can be edited by staff; a
-- recorded purchase is final (its stock movements exist).
create or replace function private.guard_purchase()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'UPDATE' then
      if old.status in ('recorded', 'pending_approval', 'cancelled') then
        raise exception 'this purchase can no longer change' using errcode = '42501';
      end if;
      if new.status not in ('draft', 'cancelled', 'rejected') or (new.status = 'rejected' and old.status <> 'rejected') then
        raise exception 'status changes go through submit_purchase' using errcode = '42501';
      end if;
      if new.recorded_at is distinct from old.recorded_at then
        raise exception 'status changes go through submit_purchase' using errcode = '42501';
      end if;
    elsif tg_op = 'INSERT' and (new.status <> 'draft' or new.recorded_at is not null) then
      raise exception 'new purchases start as drafts' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger purchases_guard before insert or update on public.purchases for each row execute function private.guard_purchase();

create or replace function private.guard_purchase_line()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  if current_user in ('authenticated', 'anon') then
    select status into v_status from public.purchases where id = coalesce(new.purchase_id, old.purchase_id);
    if v_status not in ('draft', 'rejected') then
      raise exception 'lines of a submitted purchase can''t change' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger purchase_lines_guard before insert or update or delete on public.purchase_lines for each row execute function private.guard_purchase_line();

-- No location (stock or project) may hold a negative quantity.
create or replace function private.check_stock_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qty numeric;
begin
  select coalesce(sum(quantity), 0) into v_qty from public.inventory_movements
  where item_id = new.item_id and contract_id is not distinct from new.contract_id;
  if v_qty < -0.0005 then
    raise exception 'not enough quantity at this location (would be %)', v_qty using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger inventory_movements_balance after insert on public.inventory_movements
  deferrable initially deferred
  for each row execute function private.check_stock_balance();

-- Post a purchase: material lines become stock movements at their unit price
-- (net of VAT when the company is VAT-registered, since VAT is recoverable).
create or replace function private.post_purchase(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.purchases;
  l public.purchase_lines;
  v_vat_reg boolean;
  v_factor numeric := 1;
begin
  select * into p from public.purchases where id = p_id for update;
  select o.vat_number is not null into v_vat_reg from public.organizations o where o.id = p.organization_id;
  -- without a VAT number, VAT is part of the cost: spread it over the lines
  if not v_vat_reg and p.subtotal > 0 then
    v_factor := p.total / p.subtotal;
  end if;
  for l in select * from public.purchase_lines where purchase_id = p_id and kind = 'material' order by seq loop
    insert into public.inventory_movements (organization_id, item_id, contract_id, kind, quantity, unit_cost, purchase_line_id, note)
    values (p.organization_id, l.item_id, p.contract_id, 'purchase', l.quantity, round(l.amount / l.quantity * v_factor, 4), l.id, p.number);
  end loop;
  update public.purchases set status = 'recorded', recorded_at = now() where id = p_id;
end;
$$;
revoke all on function private.post_purchase(uuid) from public;

-- Submit a draft: check it, then record it, or ask the owner when it's above the limit.
create or replace function public.submit_purchase(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.purchases;
  v_limit numeric;
  v_sub numeric;
  v_lines int;
begin
  select * into p from public.purchases where id = p_id for update;
  if p.id is null or not private.has_permission(p.organization_id, 'purchases.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p.status not in ('draft', 'rejected') then
    raise exception 'already submitted' using errcode = '22023';
  end if;
  select count(*), coalesce(sum(amount), 0) into v_lines, v_sub from public.purchase_lines where purchase_id = p_id;
  if v_lines = 0 then
    raise exception 'a purchase needs at least one line' using errcode = '22023';
  end if;
  if abs(v_sub - p.subtotal) > 0.05 or abs(p.subtotal + p.vat - p.total) > 0.05 then
    raise exception 'totals don''t add up' using errcode = '22023';
  end if;
  if p.contract_id is not null and exists (select 1 from public.contracts c where c.id = p.contract_id and c.status = 'cancelled') then
    raise exception 'the project is cancelled' using errcode = '22023';
  end if;

  select s.purchase_approval_limit into v_limit from public.pricing_settings s where s.organization_id = p.organization_id;
  if v_limit is not null and p.total > v_limit and not private.has_permission(p.organization_id, 'approvals.decide') then
    update public.approvals set status = 'cancelled' where entity = 'purchase' and entity_id = p_id and status = 'pending';
    insert into public.approvals (organization_id, kind, entity, entity_id, details)
    values (p.organization_id, 'purchase_limit', 'purchase', p_id,
            jsonb_build_object('number', p.number, 'total', p.total, 'limit', v_limit, 'supplier', p.supplier_name));
    update public.purchases set status = 'pending_approval' where id = p_id;
    return 'pending_approval';
  end if;
  perform private.post_purchase(p_id);
  return 'recorded';
end;
$$;
revoke all on function public.submit_purchase(uuid) from public, anon;
grant execute on function public.submit_purchase(uuid) to authenticated, service_role;

-- The owner's decision on a purchase approval records or rejects the purchase.
create or replace function private.apply_purchase_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entity = 'purchase' and new.status is distinct from old.status then
    if new.status = 'approved' then
      if exists (select 1 from public.purchases where id = new.entity_id and status = 'pending_approval') then
        perform private.post_purchase(new.entity_id);
      end if;
    elsif new.status = 'rejected' then
      update public.purchases set status = 'rejected' where id = new.entity_id and status = 'pending_approval';
    end if;
  end if;
  return new;
end;
$$;
create trigger approvals_purchase_decision after update on public.approvals for each row execute function private.apply_purchase_decision();

-- Average cost of an item at a location (stock or a project).
create or replace function private.average_cost(p_item uuid, p_contract uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select sum(quantity * unit_cost) / nullif(sum(quantity), 0) from public.inventory_movements
     where item_id = p_item and contract_id is not distinct from p_contract and quantity > 0),
    0)
$$;

-- Move material between general stock (null) and projects, at average cost.
-- Project-specific items (is_general = false) never go back to general stock.
create or replace function public.move_stock(p_item uuid, p_quantity numeric, p_from uuid, p_to uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.inventory_items;
  v_group uuid := gen_random_uuid();
  v_cost numeric;
  v_kind text;
begin
  select * into i from public.inventory_items where id = p_item;
  if i.id is null or not private.has_permission(i.organization_id, 'purchases.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_from is not distinct from p_to then
    raise exception 'invalid movement' using errcode = '22023';
  end if;
  if p_to is null and not i.is_general then
    raise exception 'project-specific material stays on its project' using errcode = '22023';
  end if;
  if char_length(p_note) > 300 then
    raise exception 'note too long' using errcode = '22023';
  end if;
  if exists (select 1 from public.contracts c where c.id in (p_from, p_to) and (c.organization_id <> i.organization_id or c.status = 'cancelled')) then
    raise exception 'invalid project' using errcode = '42501';
  end if;
  v_kind := case when p_from is null then 'issue' when p_to is null then 'return' else 'transfer' end;
  v_cost := round(private.average_cost(p_item, p_from), 4);
  insert into public.inventory_movements (organization_id, item_id, contract_id, kind, quantity, unit_cost, transfer_group, note)
  values (i.organization_id, p_item, p_from, v_kind, -p_quantity, v_cost, v_group, p_note),
         (i.organization_id, p_item, p_to, v_kind, p_quantity, v_cost, v_group, p_note);
  return v_group;
end;
$$;
revoke all on function public.move_stock(uuid, numeric, uuid, uuid, text) from public, anon;
grant execute on function public.move_stock(uuid, numeric, uuid, uuid, text) to authenticated, service_role;

-- Approvals: purchase staff may raise/see purchase approvals (via the function above).
drop policy approvals_select on public.approvals;
create policy approvals_select on public.approvals for select to authenticated
  using ((select private.has_permission(organization_id, 'quotes.view'))
         or (select private.has_permission(organization_id, 'approvals.decide'))
         or (entity = 'purchase' and (select private.has_permission(organization_id, 'purchases.view'))));

-- RLS -----------------------------------------------------------------------------
alter table public.inventory_items enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_lines enable row level security;
alter table public.inventory_movements enable row level security;

do $$
declare t text;
begin
  foreach t in array array['inventory_items', 'purchases', 'purchase_lines'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using ((select private.has_permission(organization_id, 'purchases.view')));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check ((select private.has_permission(organization_id, 'purchases.manage')));
      create policy %1$s_update on public.%1$s for update to authenticated
        using ((select private.has_permission(organization_id, 'purchases.manage')))
        with check ((select private.has_permission(organization_id, 'purchases.manage')));
    $f$, t);
  end loop;
end $$;
create policy purchase_lines_delete on public.purchase_lines for delete to authenticated
  using ((select private.has_permission(organization_id, 'purchases.manage')));
-- movements: read-only for users; written only by the functions above
create policy inventory_movements_select on public.inventory_movements for select to authenticated
  using ((select private.has_permission(organization_id, 'purchases.view')));

revoke all on public.inventory_items, public.purchases, public.purchase_lines, public.inventory_movements from anon;
grant select, insert, update on public.inventory_items, public.purchases to authenticated;
grant select, insert, update, delete on public.purchase_lines to authenticated;
grant select on public.inventory_movements to authenticated;
grant all on public.inventory_items, public.purchases, public.purchase_lines, public.inventory_movements to service_role;

-- Private bucket for invoice photos / PDFs: <org id>/<file>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('purchase-docs', 'purchase-docs', false, 10485760,
        array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy purchase_docs_select on storage.objects
  for select to authenticated
  using (bucket_id = 'purchase-docs' and (select private.has_permission(private.storage_object_org(name), 'purchases.view')));
create policy purchase_docs_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'purchase-docs' and (select private.has_permission(private.storage_object_org(name), 'purchases.manage')));
