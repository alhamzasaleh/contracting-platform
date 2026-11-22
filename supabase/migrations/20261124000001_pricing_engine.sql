-- =============================================================================
-- Phase 2 — Pricing engine catalogue (Appendix A)
-- brands · products (+ packs) · product_prices (per supplier, history)
-- equivalence_groups · systems · system_variants · system_components
-- consumption_rates (engine parameters, A.6 defaults, editable)
--
-- Non-destructive: the earlier materials / material_prices / recipes tables
-- stay as they are (existing materials are copied into products by the
-- seed function so nothing entered is lost).
-- project_parameters / zones arrive with quotes (Phase 3) and
-- consumption_actuals with purchases (Phase 6), where their parents exist.
-- =============================================================================

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.equivalence_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- engine role this group fills, e.g. wall_finish, board_normal, c_channel
  role text not null check (role ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (char_length(name) between 2 and 120),
  description text check (char_length(description) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, role)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete set null,
  equivalence_group_id uuid references public.equivalence_groups (id) on delete set null,
  name text not null check (char_length(name) between 2 and 160),
  category text not null check (category in (
    'putty', 'primer', 'finish_paint', 'ceiling_paint', 'profile_texture', 'spray_paint', 'moisture_paint',
    'decorative', 'exterior_primer', 'exterior_putty', 'exterior_paint', 'crack_material', 'sundry',
    'gypsum_board', 'c_channel', 'omega', 'stud', 'track', 'hanger_rod', 'vertical_hanger', 'angle',
    'trough_angle', 'shadow_profile', 'screws', 'washers', 'anchors', 'clips', 'tape', 'joint_compound',
    'insulation', 'hatch', 'other'
  )),
  purchase_unit text not null check (purchase_unit in ('L', 'kg', 'piece', 'sheet', 'bar', 'box', 'roll', 'bag', 'pack', 'm2', 'm')),
  -- paint-type products: area one reference pack covers for ONE coat
  ref_pack_size numeric(12, 4) check (ref_pack_size > 0),
  coverage_per_pack numeric(12, 4) check (coverage_per_pack > 0),
  surface_factor numeric(5, 3) not null default 1 check (surface_factor > 0 and surface_factor <= 2),
  -- bars: stock length (m); boxes/rolls/bags: contents per pack
  length_m numeric(8, 3) check (length_m > 0),
  contents_per_pack numeric(12, 3) check (contents_per_pack > 0),
  -- boards: m² per sheet
  area_m2 numeric(8, 4) check (area_m2 > 0),
  colour_specific boolean not null default false,
  application text not null default 'both' check (application in ('interior', 'exterior', 'both')),
  sheen text check (char_length(sheen) <= 40),
  -- technical specs: board type/thickness/size, metal gauge/width, drying time…
  specs jsonb not null default '{}'::jsonb check (jsonb_typeof(specs) = 'object'),
  waste_percent numeric(5, 2) check (waste_percent between 0 and 100),
  show_on_quote boolean not null default true,
  datasheet_path text check (char_length(datasheet_path) <= 300),
  notes text check (char_length(notes) <= 1000),
  is_active boolean not null default true,
  legacy_material_id uuid unique references public.materials (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index products_org_idx on public.products (organization_id, category) where is_active;
create index products_group_idx on public.products (equivalence_group_id);

-- A product may be sold in several pack sizes (18 L, 4 L…).
create table public.product_packs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  size numeric(12, 4) not null check (size > 0),
  label text check (char_length(label) <= 40),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (product_id, size)
);

-- Append-only price history per pack and supplier.
create table public.product_prices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  pack_id uuid references public.product_packs (id) on delete cascade,
  supplier_id uuid references public.suppliers (id) on delete set null,
  unit_price numeric(14, 4) not null check (unit_price >= 0),
  effective_from date not null default current_date,
  source text check (char_length(source) <= 160),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index product_prices_idx on public.product_prices (product_id, pack_id, effective_from desc, created_at desc);

-- Latest price per product × pack × supplier.
create view public.product_current_prices
with (security_invoker = true) as
select distinct on (pp.product_id, pp.pack_id, pp.supplier_id)
  pp.product_id, pp.pack_id, pp.supplier_id, pp.organization_id, pp.unit_price, pp.effective_from
from public.product_prices pp
where pp.effective_from <= current_date
order by pp.product_id, pp.pack_id, pp.supplier_id, pp.effective_from desc, pp.created_at desc;

-- Systems (assemblies) and variants
create table public.systems (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  service_id uuid references public.services (id) on delete set null,
  code text not null check (code ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  kind text not null check (kind in ('gypsum_ceiling', 'gypsum_partition', 'interior_paint', 'exterior_paint')),
  name text not null check (char_length(name) between 2 and 120),
  spec_text text check (char_length(spec_text) <= 4000),
  -- parameter overrides for the engine (e.g. {"cSpacing": 1.2})
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.system_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  system_id uuid not null references public.systems (id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  name text not null check (char_length(name) between 2 and 120),
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  spec_text text check (char_length(spec_text) <= 4000),
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (system_id, code)
);

create table public.system_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  system_id uuid not null references public.systems (id) on delete cascade,
  role text not null check (role ~ '^[a-z0-9_]{2,40}$'),
  equivalence_group_id uuid references public.equivalence_groups (id) on delete set null,
  product_id uuid references public.products (id) on delete set null,
  coats numeric(5, 2) check (coats > 0 and coats <= 20),
  -- human-readable formula shown in "how was this calculated"
  formula text check (char_length(formula) <= 300),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (system_id, role)
);

-- Engine parameters (A.6): spacings, rates, coats, labour, commercial defaults.
create table public.consumption_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-zA-Z0-9_.]{2,80}$'),
  value numeric(14, 4) not null,
  unit text check (char_length(unit) <= 20),
  label text not null check (char_length(label) between 2 and 160),
  section text not null check (section in ('gypsum', 'interior', 'exterior', 'labour', 'commercial')),
  sort_order int not null default 0,
  last_reviewed_at date,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

-- -----------------------------------------------------------------------------
-- Triggers: timestamps, created_by, same-organization references, audit
-- -----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['brands', 'equivalence_groups', 'products', 'systems', 'system_variants', 'system_components', 'consumption_rates'] loop
    execute format('create trigger %1$s_updated_at before update on public.%1$s for each row execute function private.set_updated_at()', t);
  end loop;
  foreach t in array array['brands', 'equivalence_groups', 'products', 'product_packs', 'product_prices', 'systems', 'system_variants', 'system_components', 'consumption_rates'] loop
    execute format('create trigger %1$s_created_by before insert on public.%1$s for each row execute function private.set_created_by()', t);
    execute format('select private.enable_audit(%L)', 'public.' || t);
  end loop;
end $$;

create or replace function private.check_engine_refs()
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
  for ref in
    select * from (values
      ('brand_id', 'brands'), ('equivalence_group_id', 'equivalence_groups'), ('product_id', 'products'),
      ('pack_id', 'product_packs'), ('supplier_id', 'suppliers'), ('system_id', 'systems'), ('service_id', 'services')
    ) as r(col, tbl)
  loop
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
grant execute on function private.check_engine_refs() to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['products', 'product_packs', 'product_prices', 'systems', 'system_variants', 'system_components'] loop
    execute format('create trigger %1$s_refs before insert or update on public.%1$s for each row execute function private.check_engine_refs()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- RLS: structure needs catalogue.view; prices need costs.view
-- -----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['brands', 'equivalence_groups', 'products', 'product_packs', 'systems', 'system_variants', 'system_components'] loop
    execute format('alter table public.%1$s enable row level security', t);
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using ((select private.has_permission(organization_id, 'catalogue.view')));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check ((select private.has_permission(organization_id, 'catalogue.manage')));
      create policy %1$s_update on public.%1$s for update to authenticated
        using ((select private.has_permission(organization_id, 'catalogue.manage')))
        with check ((select private.has_permission(organization_id, 'catalogue.manage')));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using ((select private.has_permission(organization_id, 'catalogue.manage')));
    $f$, t);
  end loop;
end $$;

-- consumption rates include labour rates and margins → costs.view
alter table public.consumption_rates enable row level security;
create policy consumption_rates_select on public.consumption_rates for select to authenticated
  using ((select private.has_permission(organization_id, 'costs.view')));
create policy consumption_rates_insert on public.consumption_rates for insert to authenticated
  with check ((select private.has_permission(organization_id, 'catalogue.manage')) and (select private.has_permission(organization_id, 'costs.view')));
create policy consumption_rates_update on public.consumption_rates for update to authenticated
  using ((select private.has_permission(organization_id, 'catalogue.manage')) and (select private.has_permission(organization_id, 'costs.view')))
  with check ((select private.has_permission(organization_id, 'catalogue.manage')) and (select private.has_permission(organization_id, 'costs.view')));

alter table public.product_prices enable row level security;
create policy product_prices_select on public.product_prices for select to authenticated
  using ((select private.has_permission(organization_id, 'costs.view')));
create policy product_prices_insert on public.product_prices for insert to authenticated
  with check ((select private.has_permission(organization_id, 'catalogue.manage')) and (select private.has_permission(organization_id, 'costs.view')));

revoke all on public.brands, public.equivalence_groups, public.products, public.product_packs, public.product_prices,
  public.systems, public.system_variants, public.system_components, public.consumption_rates, public.product_current_prices from anon;
grant select, insert, update, delete on public.brands, public.equivalence_groups, public.products, public.product_packs,
  public.systems, public.system_variants, public.system_components to authenticated;
grant select, insert, update on public.consumption_rates to authenticated;
grant select, insert on public.product_prices to authenticated;
revoke update, delete, truncate on public.product_prices from authenticated;
revoke delete, truncate on public.consumption_rates from authenticated;
grant select on public.product_current_prices to authenticated;
grant all on all tables in schema public to service_role;

-- -----------------------------------------------------------------------------
-- Seed: Appendix A.6 defaults (editable; prices are placeholders)
-- -----------------------------------------------------------------------------

create or replace function public.seed_pricing_engine(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_products int := 0;
  v_rates int := 0;
  v_group uuid;
  v_product uuid;
  v_pack uuid;
  v_system uuid;
  r record;
begin
  if not (private.has_permission(p_org, 'catalogue.manage') and private.has_permission(p_org, 'costs.view')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.brands (organization_id, name)
  select p_org, b from unnest(array['جوتن Jotun', 'الجزيرة Al-Jazeera', 'الوطنية National', 'سايبس Sipes', 'عسيب Asib', 'كناوف Knauf', 'جيبروك Gyproc']) as b
  on conflict do nothing;

  -- Equivalence groups (one per engine role) + generic products with packs & placeholder prices.
  for r in
    select * from (values
      -- role, group name, product name, category, unit, ref_pack, coverage, length_m, contents, area, colour, application, pack_label, price, specs
      ('putty', 'معجون جدران داخلي', 'معجون جاهز 20 كجم', 'putty', 'kg', 20::numeric, 25::numeric, null::numeric, null::numeric, null::numeric, false, 'interior', '20 كجم', 45::numeric, '{}'),
      ('primer', 'أساس داخلي', 'أساس (برايمر) 18 لتر', 'primer', 'L', 18, 140, null, null, null, false, 'interior', '18 لتر', 120, '{}'),
      ('wall_finish', 'دهان جدران داخلي مطفي — درجة قياسية', 'دهان جدران 18 لتر', 'finish_paint', 'L', 18, 120, null, null, null, true, 'interior', '18 لتر', 180, '{}'),
      ('ceiling_paint', 'دهان أسقف', 'دهان أسقف 18 لتر', 'ceiling_paint', 'L', 18, 130, null, null, null, true, 'interior', '18 لتر', 140, '{}'),
      ('moisture', 'دهان مقاوم للرطوبة', 'دهان مقاوم للرطوبة 18 لتر', 'moisture_paint', 'L', 18, 110, null, null, null, true, 'interior', '18 لتر', 230, '{}'),
      ('decorative', 'دهان ديكوري (نظام كامل)', 'دهان ديكوري 5 لتر', 'decorative', 'L', 5, 15, null, null, null, true, 'interior', '5 لتر', 160, '{}'),
      ('crack_material', 'مادة معالجة الشقوق', 'مادة شقوق 5 كجم (≈20 م)', 'crack_material', 'kg', 5, null, null, 20, null, false, 'both', '5 كجم', 25, '{}'),
      ('sandpaper', 'ورق صنفرة', 'ورق صنفرة (≈150 م² للوجه)', 'sundry', 'pack', null, null, null, 150, null, false, 'both', 'علبة', 40, '{}'),
      ('floor_nylon', 'نايلون حماية أرضيات', 'نايلون 50 م²', 'sundry', 'roll', null, null, null, 50, null, false, 'both', 'لفة', 35, '{}'),
      ('masking_tape', 'شريط لاصق', 'شريط لاصق (≈60 م²)', 'sundry', 'roll', null, null, null, 60, null, false, 'both', 'لفة', 6, '{}'),
      ('ext_primer', 'أساس خارجي', 'أساس خارجي 18 لتر', 'exterior_primer', 'L', 18, 200, null, null, null, false, 'exterior', '18 لتر', 135, '{}'),
      ('ext_putty', 'معجون خارجي', 'معجون خارجي 20 كجم', 'exterior_putty', 'kg', 20, 25, null, null, null, false, 'exterior', '20 كجم', 90, '{}'),
      ('acrylic', 'أكريليك خارجي', 'أكريليك خارجي 18 لتر', 'exterior_paint', 'L', 18, 150, null, null, null, true, 'exterior', '18 لتر', 340, '{}'),
      ('spray_acrylic', 'أكريليك رش', 'أكريليك رش 18 لتر', 'spray_paint', 'L', 18, 140, null, null, null, true, 'exterior', '18 لتر', 345, '{"wastePercent": 15}'),
      ('profile', 'بروفايل / تكسير خارجي', 'بروفايل خارجي', 'profile_texture', 'L', 18, 60, null, null, null, true, 'exterior', '18 لتر', 0, '{}'),
      ('board_normal', 'لوح جبس عادي 12.5 مم', 'لوح جبس عادي 12.5مم 120×240', 'gypsum_board', 'sheet', null, null, null, null, 2.88, false, 'interior', 'لوح', 22, '{"type":"normal","thickness":12.5,"size":"120x240"}'),
      ('board_moisture', 'لوح جبس مقاوم للرطوبة', 'لوح مقاوم للرطوبة 12.5مم 120×240', 'gypsum_board', 'sheet', null, null, null, null, 2.88, false, 'interior', 'لوح', 30, '{"type":"moisture","thickness":12.5,"size":"120x240"}'),
      ('board_fire', 'لوح جبس مقاوم للحريق', 'لوح مقاوم للحريق 12.5مم 120×240', 'gypsum_board', 'sheet', null, null, null, null, 2.88, false, 'interior', 'لوح', 34, '{"type":"fire","thickness":12.5,"size":"120x240"}'),
      ('c_channel', 'قطاع C رئيسي', 'قطاع C 3م', 'c_channel', 'bar', null, null, 3, null, null, false, 'interior', 'عود 3م', 11, '{}'),
      ('omega', 'قطاع أوميغا', 'أوميغا 3م', 'omega', 'bar', null, null, 3, null, null, false, 'interior', 'عود 3م', 9, '{}'),
      ('rod', 'سيخ تعليق مسنن', 'سيخ مسنن 3م', 'hanger_rod', 'bar', null, null, 3, null, null, false, 'interior', 'عود 3م', 7, '{}'),
      ('vertical_hanger', 'علاقة C رأسية', 'علاقة C رأسية 3م', 'vertical_hanger', 'bar', null, null, 3, null, null, false, 'interior', 'عود 3م', 11, '{}'),
      ('edge_angle', 'زاوية محيط', 'زاوية محيط 3م', 'angle', 'bar', null, null, 3, null, null, false, 'interior', 'عود 3م', 6, '{}'),
      ('trough_angle', 'زاوية حماية بيت الإنارة', 'زاوية حماية 3م', 'trough_angle', 'bar', null, null, 3, null, null, false, 'interior', 'عود 3م', 7, '{}'),
      ('shadow', 'بروفايل شادو', 'بروفايل شادو 3م', 'shadow_profile', 'bar', null, null, 3, null, null, false, 'interior', 'عود 3م', 25, '{}'),
      ('stud', 'قائم (ستد)', 'ستد 3م', 'stud', 'bar', null, null, 3, null, null, false, 'interior', 'عود 3م', 14, '{}'),
      ('track', 'مجرى (تراك)', 'تراك 3م', 'track', 'bar', null, null, 3, null, null, false, 'interior', 'عود 3م', 11, '{}'),
      ('washers', 'وردات وصواميل', 'وردات (علبة 100)', 'washers', 'box', null, null, null, 100, null, false, 'interior', 'علبة 100', 25, '{}'),
      ('anchors', 'فيشر', 'فيشر (علبة 100)', 'anchors', 'box', null, null, null, 100, null, false, 'interior', 'علبة 100', 30, '{}'),
      ('clips', 'كلبسات', 'كلبسات (علبة 100)', 'clips', 'box', null, null, null, 100, null, false, 'interior', 'علبة 100', 25, '{}'),
      ('angle_screws', 'مسامير زاوية', 'مسامير زاوية (علبة 100)', 'screws', 'box', null, null, null, 100, null, false, 'interior', 'علبة 100', 15, '{}'),
      ('board_screws', 'مسامير ألواح', 'مسامير ألواح (علبة 1000)', 'screws', 'box', null, null, null, 1000, null, false, 'interior', 'علبة 1000', 35, '{}'),
      ('joint_tape', 'شريط فواصل', 'شريط فواصل 90م', 'tape', 'roll', null, null, null, 90, null, false, 'interior', 'لفة 90م', 12, '{}'),
      ('joint_compound', 'معجون فواصل', 'معجون فواصل 20 كجم', 'joint_compound', 'bag', null, null, null, 20, null, false, 'interior', 'كيس 20 كجم', 28, '{}'),
      ('insulation', 'عزل صوف صخري', 'صوف صخري (م²)', 'insulation', 'm2', null, null, null, null, null, false, 'interior', 'م²', 18, '{}'),
      ('hatch_30x30', 'فتحة صيانة 30×30', 'فتحة صيانة 30×30 (توريد وتركيب)', 'hatch', 'piece', null, null, null, null, null, false, 'interior', 'قطعة', 60, '{}'),
      ('hatch_40x40', 'فتحة صيانة 40×40', 'فتحة صيانة 40×40 (توريد وتركيب)', 'hatch', 'piece', null, null, null, null, null, false, 'interior', 'قطعة', 75, '{}'),
      ('hatch_50x50', 'فتحة صيانة 50×50', 'فتحة صيانة 50×50 (توريد وتركيب)', 'hatch', 'piece', null, null, null, null, null, false, 'interior', 'قطعة', 90, '{}'),
      ('hatch_60x60', 'فتحة صيانة 60×60', 'فتحة صيانة 60×60 (توريد وتركيب)', 'hatch', 'piece', null, null, null, null, null, false, 'interior', 'قطعة', 110, '{}'),
      ('hatch_60x120', 'فتحة صيانة 60×120', 'فتحة صيانة 60×120 (توريد وتركيب)', 'hatch', 'piece', null, null, null, null, null, false, 'interior', 'قطعة', 180, '{}')
    ) as t(role, group_name, product_name, category, unit, ref_pack, coverage, length_m, contents, area, colour, application, pack_label, price, specs)
  loop
    insert into public.equivalence_groups (organization_id, role, name)
    values (p_org, r.role, r.group_name)
    on conflict (organization_id, role) do nothing
    returning id into v_group;
    if v_group is null then
      continue; -- already seeded
    end if;

    insert into public.products (organization_id, equivalence_group_id, name, category, purchase_unit, ref_pack_size,
      coverage_per_pack, length_m, contents_per_pack, area_m2, colour_specific, application, specs, waste_percent)
    values (p_org, v_group, r.product_name, r.category, r.unit, r.ref_pack, r.coverage, r.length_m, r.contents, r.area,
      r.colour, r.application, r.specs::jsonb, (r.specs::jsonb ->> 'wastePercent')::numeric)
    returning id into v_product;

    insert into public.product_packs (organization_id, product_id, size, label)
    values (p_org, v_product, coalesce(r.ref_pack, r.contents, r.length_m, r.area, 1), r.pack_label)
    returning id into v_pack;

    if r.price > 0 then
      insert into public.product_prices (organization_id, product_id, pack_id, unit_price, source)
      values (p_org, v_product, v_pack, r.price, 'قيمة افتراضية — حدّثها');
    end if;
    v_products := v_products + 1;
    v_group := null;
  end loop;

  -- Engine parameters
  insert into public.consumption_rates (organization_id, section, sort_order, key, value, unit, label)
  values
    (p_org, 'gypsum', 1, 'gypsum.cSpacing', 1.0, 'm', 'تباعد القطاع الرئيسي C'),
    (p_org, 'gypsum', 2, 'gypsum.omegaSpacing', 0.4, 'm', 'تباعد الأوميغا'),
    (p_org, 'gypsum', 3, 'gypsum.hangerSpacing', 1.0, 'm', 'تباعد العلاقات على C'),
    (p_org, 'gypsum', 4, 'gypsum.studSpacing', 0.6, 'm', 'تباعد القوائم (قواطع)'),
    (p_org, 'gypsum', 5, 'gypsum.partitionHeight', 3, 'm', 'ارتفاع القواطع'),
    (p_org, 'gypsum', 6, 'gypsum.hangingHeight', 0.4, 'm', 'ارتفاع التعليق'),
    (p_org, 'gypsum', 7, 'gypsum.screwsPerM2PerLayer', 15, 'pcs', 'مسامير لكل م² لكل طبقة'),
    (p_org, 'gypsum', 8, 'gypsum.tapePerM2', 1.4, 'm', 'شريط فواصل لكل م² منتهي'),
    (p_org, 'gypsum', 9, 'gypsum.compoundPerM2', 0.45, 'kg', 'معجون فواصل لكل م² منتهي'),
    (p_org, 'gypsum', 10, 'gypsum.angleScrewsPerM', 2.5, 'pcs', 'مسامير الزاوية لكل متر محيط'),
    (p_org, 'gypsum', 11, 'gypsum.perimeterFactor', 0.7, 'm', 'محيط تقديري لكل م² سقف (عند عدم معرفته)'),
    (p_org, 'gypsum', 12, 'gypsum.trough.boardPerM', 0.6, 'm2', 'بيت إنارة: ألواح لكل متر'),
    (p_org, 'gypsum', 13, 'gypsum.trough.omegaPerM', 2, 'm', 'بيت إنارة: أوميغا إضافي لكل متر'),
    (p_org, 'gypsum', 14, 'gypsum.trough.protectionAnglePerM', 2, 'm', 'بيت إنارة: زاوية حماية لكل متر'),
    (p_org, 'gypsum', 15, 'gypsum.trough.hangersPerM', 1, 'pcs', 'بيت إنارة: علاقات إضافية لكل متر'),
    (p_org, 'gypsum', 16, 'gypsum.cutAllowance', 0.15, 'm', 'سماحية قص لكل علاقة'),
    (p_org, 'gypsum', 17, 'gypsum.productivity', 40, 'm2/day', 'إنتاجية الفريق (جبس)'),
    (p_org, 'gypsum', 18, 'gypsum.wastePercent', 5, '%', 'نسبة الهدر (مواد الجبس)'),
    (p_org, 'interior', 1, 'interior.coats.wallPutty', 2, 'coats', 'أوجه معجون الجدران'),
    (p_org, 'interior', 2, 'interior.coats.ceilingPutty', 1, 'coats', 'أوجه معجون الأسقف'),
    (p_org, 'interior', 3, 'interior.coats.primer', 1, 'coats', 'أوجه الأساس'),
    (p_org, 'interior', 4, 'interior.coats.wallFinish', 2, 'coats', 'أوجه دهان الجدران'),
    (p_org, 'interior', 5, 'interior.coats.ceilingPaint', 2, 'coats', 'أوجه دهان الأسقف'),
    (p_org, 'interior', 6, 'interior.coats.moisture', 2, 'coats', 'أوجه الدهان المقاوم للرطوبة'),
    (p_org, 'interior', 7, 'interior.repaintSpotPercent', 20, '%', 'إعادة دهان: نسبة المعجون الموضعي'),
    (p_org, 'interior', 8, 'interior.wastePercent', 5, '%', 'نسبة هدر الدهان'),
    (p_org, 'interior', 9, 'interior.consumablesPerM2', 0.5, 'SAR', 'مستهلكات لكل م² (رولات، فرش)'),
    (p_org, 'interior', 10, 'interior.productivity', 120, 'm2/day', 'إنتاجية الفريق (دهان داخلي)'),
    (p_org, 'exterior', 1, 'exterior.coats.primer', 1, 'coats', 'أوجه الأساس الخارجي'),
    (p_org, 'exterior', 2, 'exterior.coats.putty', 1, 'coats', 'أوجه المعجون الخارجي'),
    (p_org, 'exterior', 3, 'exterior.coats.finish', 2, 'coats', 'أوجه الدهان الخارجي'),
    (p_org, 'exterior', 4, 'exterior.wastePercent', 5, '%', 'نسبة الهدر (رولة)'),
    (p_org, 'exterior', 5, 'exterior.sprayWastePercent', 15, '%', 'نسبة الهدر (رش)'),
    (p_org, 'exterior', 6, 'exterior.scaffoldPerDay', 0, 'SAR', 'إيجار السقالات / الرافعة باليوم'),
    (p_org, 'exterior', 7, 'exterior.productivity', 100, 'm2/day', 'إنتاجية الفريق (خارجي)'),
    (p_org, 'labour', 1, 'labour.gypsum.ceilings', 12, 'SAR/m2', 'مصنعية أسقف جبس (تشمل السبوت وفتحات المكيف)'),
    (p_org, 'labour', 2, 'labour.gypsum.partitions', 15, 'SAR/m2', 'مصنعية قواطع'),
    (p_org, 'labour', 3, 'labour.gypsum.extraLayer', 5, 'SAR/m2', 'مصنعية طبقة إضافية'),
    (p_org, 'labour', 4, 'labour.gypsum.trough', 15, 'SAR/m', 'مصنعية بيت إنارة'),
    (p_org, 'labour', 5, 'labour.gypsum.shadow', 8, 'SAR/m', 'مصنعية شادو'),
    (p_org, 'labour', 6, 'labour.interior.wallsFull', 12, 'SAR/m2', 'مصنعية دهان جدران (نظام كامل)'),
    (p_org, 'labour', 7, 'labour.interior.ceilingsFull', 14, 'SAR/m2', 'مصنعية دهان أسقف (نظام كامل)'),
    (p_org, 'labour', 8, 'labour.interior.repaint', 7, 'SAR/m2', 'مصنعية إعادة دهان'),
    (p_org, 'labour', 9, 'labour.interior.decorativeExtra', 15, 'SAR/m2', 'إضافة مصنعية ديكوري'),
    (p_org, 'labour', 10, 'labour.interior.cracks', 5, 'SAR/m', 'مصنعية معالجة الشقوق'),
    (p_org, 'labour', 11, 'labour.exterior.application', 6, 'SAR/m2', 'مصنعية دهان خارجي'),
    (p_org, 'labour', 12, 'labour.exterior.sandingPutty', 4, 'SAR/m2', 'مصنعية صنفرة ومعجون خارجي'),
    (p_org, 'labour', 13, 'labour.exterior.spray', 4.5, 'SAR/m2', 'مصنعية رش'),
    (p_org, 'commercial', 1, 'commercial.quoteValidityDays', 7, 'days', 'صلاحية العرض'),
    (p_org, 'commercial', 2, 'commercial.targetMarginPercent', 28, '%', 'الهامش المستهدف'),
    (p_org, 'commercial', 3, 'commercial.contingencyPercent', 5, '%', 'احتياطي المخاطر'),
    (p_org, 'commercial', 4, 'commercial.roundingStep', 1, 'SAR', 'تقريب سعر المتر')
  on conflict (organization_id, key) do nothing;
  get diagnostics v_rates = row_count;

  -- Systems with variants and components (components point to equivalence groups).
  for r in
    select * from (values
      ('gypsum-ceiling', 'gypsum_ceiling', 'أسقف جبس بورد', 'gypsum', 'ألواح جبس 12.5 مم على هيكل معدني (قطاع C وأوميغا) معلّق بالأسياخ والوردات، معالجة الفواصل بالشريط والمعجون وجهين ووجه ثالث عند الحاجة، تسليم السطح جاهزاً للدهان.', array['board_normal','board_moisture','board_fire','c_channel','omega','rod','vertical_hanger','washers','anchors','clips','edge_angle','angle_screws','trough_angle','shadow','board_screws','joint_tape','joint_compound']),
      ('gypsum-partition', 'gypsum_partition', 'قواطع جبس بورد', 'gypsum', 'قواطع جبس على قوائم ومجاري معدنية بتباعد 60 سم، لوح على كل وجه، عزل صوف صخري اختياري، معالجة الفواصل.', array['board_normal','board_moisture','board_fire','stud','track','board_screws','joint_tape','joint_compound','insulation']),
      ('interior-paint', 'interior_paint', 'دهانات داخلية', 'interior-paint', 'معجون وجهين للجدران ووجه للأسقف مع الصنفرة، أساس وجه واحد، دهان وجهين. الوجه النهائي بعد تركيب الأبواب والنوافذ والإنارة.', array['putty','primer','wall_finish','ceiling_paint','moisture','decorative','crack_material','sandpaper','floor_nylon','masking_tape']),
      ('exterior-paint', 'exterior_paint', 'دهانات خارجية', 'exterior-paint', 'معالجة الشروخ، أساس خارجي، معجون خارجي، دهان أكريليك وجهين أو بروفايل أو رش حسب الاختيار.', array['ext_primer','ext_putty','acrylic','profile','spray_acrylic'])
    ) as t(code, kind, name, service_code, spec, roles)
  loop
    insert into public.systems (organization_id, code, kind, name, spec_text, service_id)
    values (p_org, r.code, r.kind, r.name, r.spec, (select s.id from public.services s where s.organization_id = p_org and s.code = r.service_code))
    on conflict (organization_id, code) do nothing
    returning id into v_system;
    if v_system is null then
      continue;
    end if;

    insert into public.system_components (organization_id, system_id, role, equivalence_group_id, sort_order)
    select p_org, v_system, role, (select g.id from public.equivalence_groups g where g.organization_id = p_org and g.role = x.role), ord
    from unnest(r.roles) with ordinality as x(role, ord);

    insert into public.system_variants (organization_id, system_id, code, name, params, is_default, sort_order)
    select p_org, v_system, v.code, v.name, v.params::jsonb, v.is_default, v.ord
    from (values
      ('gypsum-ceiling', 'rod', 'تعليق بالأسياخ والوردات', '{"suspension":"rod","layers":1}', true, 1),
      ('gypsum-ceiling', 'vertical_c', 'تعليق بعلاقات C رأسية', '{"suspension":"vertical_c","layers":1}', false, 2),
      ('gypsum-ceiling', 'double', 'طبقتين ألواح', '{"suspension":"rod","layers":2}', false, 3),
      ('gypsum-partition', 'single', 'لوح على كل وجه', '{"layersPerFace":1}', true, 1),
      ('gypsum-partition', 'double', 'لوحين على كل وجه', '{"layersPerFace":2}', false, 2),
      ('gypsum-partition', 'insulated', 'مع عزل صوف صخري', '{"layersPerFace":1,"insulation":true}', false, 3),
      ('interior-paint', 'new', 'نظام كامل (جديد)', '{"variant":"new"}', true, 1),
      ('interior-paint', 'repaint', 'إعادة دهان', '{"variant":"repaint"}', false, 2),
      ('exterior-paint', 'roller', 'دهان بالرولة', '{"method":"roller"}', true, 1),
      ('exterior-paint', 'profile', 'بروفايل / تكسير', '{"method":"profile"}', false, 2),
      ('exterior-paint', 'spray', 'رش', '{"method":"spray"}', false, 3)
    ) as v(system_code, code, name, params, is_default, ord)
    where v.system_code = r.code;

    v_system := null;
  end loop;

  -- Carry over materials entered before the engine existed.
  insert into public.products (organization_id, name, category, purchase_unit, coverage_per_pack, ref_pack_size,
    colour_specific, notes, legacy_material_id, brand_id)
  select m.organization_id, m.name_ar, 'other',
    case m.unit when 'liter' then 'L' when 'gallon' then 'L' when 'kg' then 'kg' when 'sheet' then 'sheet'
      when 'roll' then 'roll' when 'bag' then 'bag' when 'box' then 'box' when 'm2' then 'm2' when 'm' then 'm' else 'piece' end,
    m.coverage_per_unit, case when m.coverage_per_unit is not null then 1 end, m.scope = 'project', m.notes, m.id,
    (select b.id from public.brands b where b.organization_id = m.organization_id and m.brand is not null and b.name ilike '%' || m.brand || '%' limit 1)
  from public.materials m
  where m.organization_id = p_org
  on conflict (legacy_material_id) do nothing;

  return jsonb_build_object('products', v_products, 'rates', v_rates);
end;
$$;

revoke execute on function public.seed_pricing_engine(uuid) from public, anon;
grant execute on function public.seed_pricing_engine(uuid) to authenticated;
