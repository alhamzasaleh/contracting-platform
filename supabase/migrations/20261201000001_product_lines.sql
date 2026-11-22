-- =============================================================================
-- Owner's product model: a PRODUCT (e.g. "بروفايل خارجي") is defined once —
-- its type and its coverage per litre/kg per coat (or bar length, board area,
-- pack contents). Under it, each BRAND only adds pack sizes and prices.
-- Coverage per pack follows the pack size automatically (18 L covers 18 × per-litre).
--
-- Stored on equivalence_groups (one per pricing line). A brand row (products)
-- may override the coverage when that brand really differs.
-- Non-destructive: new nullable columns, backfilled from existing products.
-- =============================================================================

alter table public.equivalence_groups
  add column category text check (category in (
    'putty', 'primer', 'sealer', 'finish_paint', 'ceiling_paint', 'profile_texture', 'spray_paint', 'moisture_paint',
    'decorative', 'exterior_primer', 'exterior_putty', 'exterior_paint', 'crack_material', 'sundry',
    'gypsum_board', 'c_channel', 'omega', 'stud', 'track', 'hanger_rod', 'vertical_hanger', 'angle',
    'trough_angle', 'shadow_profile', 'screws', 'washers', 'anchors', 'clips', 'tape', 'joint_compound',
    'insulation', 'hatch', 'other')),
  add column purchase_unit text check (purchase_unit in ('L', 'kg', 'piece', 'sheet', 'bar', 'box', 'roll', 'bag', 'pack', 'm2', 'm')),
  add column coverage_per_unit numeric(12, 4) check (coverage_per_unit > 0),
  add column length_m numeric(8, 3) check (length_m > 0),
  add column contents_per_pack numeric(12, 3) check (contents_per_pack > 0),
  add column area_m2 numeric(8, 4) check (area_m2 > 0),
  add column colour_specific boolean not null default false,
  add column waste_percent numeric(5, 2) check (waste_percent between 0 and 100);

comment on column public.equivalence_groups.coverage_per_unit is 'm² covered by ONE litre/kg for ONE coat — shared by every brand of this product.';

-- Brand-specific coverage when a brand really differs (null = use the product''s).
alter table public.products
  add column coverage_per_unit numeric(12, 4) check (coverage_per_unit > 0);

-- Backfill each product line from its first (oldest) brand row.
update public.equivalence_groups g
set category = p.category,
    purchase_unit = p.purchase_unit,
    coverage_per_unit = case when p.coverage_per_pack is not null and p.ref_pack_size is not null
                             then round(p.coverage_per_pack / p.ref_pack_size, 4) end,
    length_m = p.length_m,
    contents_per_pack = p.contents_per_pack,
    area_m2 = p.area_m2,
    colour_specific = p.colour_specific,
    waste_percent = p.waste_percent
from (
  select distinct on (equivalence_group_id) *
  from public.products
  where equivalence_group_id is not null
  order by equivalence_group_id, created_at
) p
where p.equivalence_group_id = g.id;

-- Brand rows whose coverage differs from their line keep it as an override.
update public.products p
set coverage_per_unit = round(p.coverage_per_pack / p.ref_pack_size, 4)
from public.equivalence_groups g
where g.id = p.equivalence_group_id
  and p.coverage_per_pack is not null and p.ref_pack_size is not null
  and round(p.coverage_per_pack / p.ref_pack_size, 4) is distinct from g.coverage_per_unit;

-- Lines that still have no coverage take it from any complete brand (e.g. the
-- owner completed a Jotun profile while the generic one stayed empty).
update public.equivalence_groups g
set coverage_per_unit = x.cov
from (
  select distinct on (equivalence_group_id) equivalence_group_id, round(coverage_per_pack / ref_pack_size, 4) as cov
  from public.products
  where coverage_per_pack is not null and ref_pack_size is not null and equivalence_group_id is not null
  order by equivalence_group_id, updated_at desc
) x
where x.equivalence_group_id = g.id and g.coverage_per_unit is null;

-- A product line with no definition yet takes it from the first brand row added
-- to it (covers the seed for new organizations and legacy inserts).
create or replace function private.fill_line_from_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.equivalence_group_id is not null then
    update public.equivalence_groups g
    set category = new.category,
        purchase_unit = new.purchase_unit,
        coverage_per_unit = coalesce(g.coverage_per_unit,
          case when new.coverage_per_pack is not null and new.ref_pack_size is not null
               then round(new.coverage_per_pack / new.ref_pack_size, 4) end),
        length_m = coalesce(g.length_m, new.length_m),
        contents_per_pack = coalesce(g.contents_per_pack, new.contents_per_pack),
        area_m2 = coalesce(g.area_m2, new.area_m2),
        colour_specific = g.colour_specific or new.colour_specific,
        waste_percent = coalesce(g.waste_percent, new.waste_percent)
    where g.id = new.equivalence_group_id and g.category is null;
  end if;
  return null;
end;
$$;
grant execute on function private.fill_line_from_product() to authenticated, service_role;

create trigger products_fill_line
  after insert or update of equivalence_group_id on public.products
  for each row execute function private.fill_line_from_product();
