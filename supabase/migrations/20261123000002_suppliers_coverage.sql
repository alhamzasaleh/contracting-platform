-- =============================================================================
-- Phase 2.1 — Suppliers, brands and coverage-based recipes
-- * suppliers: who we buy from (also used by purchases in Phase 6)
-- * materials: brand, package description, coverage (m² per unit per coat),
--   preferred supplier
-- * material_prices: which supplier the price is from
-- * recipes: "coverage" mode — quantity per m² = coats ÷ coverage per unit —
--   or "fixed" quantity per m² as before
-- Non-destructive: adds columns/tables, relaxes one NOT NULL.
-- =============================================================================

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  contact_name text check (char_length(contact_name) <= 120),
  phone text check (phone ~ '^[0-9]{8,15}$'),
  vat_number text check (vat_number ~ '^3[0-9]{13}3$'),
  city text check (char_length(city) <= 80),
  notes text check (char_length(notes) <= 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create trigger suppliers_updated_at before update on public.suppliers
  for each row execute function private.set_updated_at();
create trigger suppliers_created_by before insert on public.suppliers
  for each row execute function private.set_created_by();
select private.enable_audit('public.suppliers');

alter table public.suppliers enable row level security;
create policy suppliers_select on public.suppliers for select to authenticated
  using ((select private.has_permission(organization_id, 'catalogue.view'))
      or (select private.has_permission(organization_id, 'purchases.view')));
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check ((select private.has_permission(organization_id, 'catalogue.manage'))
           or (select private.has_permission(organization_id, 'purchases.manage')));
create policy suppliers_update on public.suppliers for update to authenticated
  using ((select private.has_permission(organization_id, 'catalogue.manage'))
      or (select private.has_permission(organization_id, 'purchases.manage')))
  with check ((select private.has_permission(organization_id, 'catalogue.manage'))
           or (select private.has_permission(organization_id, 'purchases.manage')));

revoke all on public.suppliers from anon;
grant select, insert, update on public.suppliers to authenticated;
grant all on public.suppliers to service_role;

-- Materials: brand, package, coverage, preferred supplier
alter table public.materials
  add column brand text check (char_length(brand) <= 80),
  add column package_desc text check (char_length(package_desc) <= 80),
  add column coverage_per_unit numeric(12, 4) check (coverage_per_unit > 0),
  add column preferred_supplier_id uuid references public.suppliers (id) on delete set null;

comment on column public.materials.coverage_per_unit is
  'Area (m²) one unit covers for ONE coat/layer, e.g. a 2.88 m² gypsum board, or 35 m² per paint gallon';

-- Prices: which supplier
alter table public.material_prices
  add column supplier_id uuid references public.suppliers (id) on delete set null;

-- Latest price per material per supplier (for comparing suppliers).
create view public.material_supplier_prices
with (security_invoker = true) as
select distinct on (mp.material_id, mp.supplier_id)
  mp.material_id, mp.supplier_id, mp.organization_id, mp.unit_price, mp.effective_from, mp.created_at
from public.material_prices mp
where mp.effective_from <= current_date
order by mp.material_id, mp.supplier_id, mp.effective_from desc, mp.created_at desc;

revoke all on public.material_supplier_prices from anon;
grant select on public.material_supplier_prices to authenticated;

-- Current price: preferred supplier's latest price if there is one, else latest overall.
create or replace view public.material_current_prices
with (security_invoker = true) as
select distinct on (mp.material_id)
  mp.material_id, mp.organization_id, mp.unit_price, mp.effective_from, mp.created_at, mp.supplier_id
from public.material_prices mp
join public.materials m on m.id = mp.material_id
where mp.effective_from <= current_date
order by mp.material_id,
  (mp.supplier_id is not distinct from m.preferred_supplier_id and m.preferred_supplier_id is not null) desc,
  mp.effective_from desc, mp.created_at desc;

-- Recipes: coverage mode
alter table public.service_material_recipes
  add column calc_mode text not null default 'fixed' check (calc_mode in ('fixed', 'coverage')),
  add column coats numeric(5, 2) not null default 1 check (coats > 0 and coats <= 20);
alter table public.service_material_recipes alter column qty_per_unit drop not null;
alter table public.service_material_recipes
  add constraint recipes_qty_required_for_fixed check (calc_mode = 'coverage' or qty_per_unit is not null);

-- Same-organization checks for the new references.
create or replace function private.check_supplier_same_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier uuid;
  v_org uuid;
begin
  if tg_table_name = 'materials' then
    v_supplier := new.preferred_supplier_id;
  else
    v_supplier := new.supplier_id;
  end if;
  if v_supplier is not null then
    select s.organization_id into v_org from public.suppliers s where s.id = v_supplier;
    if v_org is distinct from new.organization_id then
      raise exception 'supplier belongs to another organization' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
grant execute on function private.check_supplier_same_org() to authenticated, service_role;

create trigger materials_supplier_same_org before insert or update on public.materials
  for each row execute function private.check_supplier_same_org();
create trigger material_prices_supplier_same_org before insert on public.material_prices
  for each row execute function private.check_supplier_same_org();
