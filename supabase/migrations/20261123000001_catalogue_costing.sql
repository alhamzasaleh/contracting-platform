-- =============================================================================
-- Phase 2 — Catalogue & costing
-- Services, stages, spec templates, materials with price history, recipes
-- (bill of materials per m²), labour rates, extra cost items, pricing
-- settings, employees and statutory cost items (fully loaded labour cost).
--
-- Visibility rules:
--   * Catalogue structure (services, stages, specs, materials, recipes):
--     catalogue.view to read, catalogue.manage to change.
--   * Anything with money (prices, labour rates, extra costs, pricing
--     settings): costs.view to read; catalogue.manage + costs.view to change.
--   * Employees and their costs: hr.view / hr.manage only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- New permissions: hr.view, hr.manage
-- -----------------------------------------------------------------------------

create or replace function private.all_permissions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'settings.manage', 'members.manage', 'audit.view',
    'clients.view', 'clients.manage',
    'catalogue.view', 'catalogue.manage', 'costs.view',
    'quotes.view', 'quotes.manage',
    'projects.view', 'projects.manage',
    'schedule.view', 'schedule.manage',
    'purchases.view', 'purchases.manage',
    'finance.view', 'finance.manage',
    'approvals.decide', 'reports.view',
    'hr.view', 'hr.manage'
  ]::text[]
$$;

create or replace function private.role_permissions(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'owner' then private.all_permissions()
    when 'supervisor' then array[
      'clients.view', 'clients.manage', 'catalogue.view', 'costs.view',
      'quotes.view', 'quotes.manage', 'projects.view', 'projects.manage',
      'schedule.view', 'schedule.manage', 'purchases.view', 'purchases.manage'
    ]::text[]
    when 'finance' then array[
      'clients.view', 'catalogue.view', 'costs.view', 'quotes.view', 'projects.view',
      'schedule.view', 'purchases.view', 'purchases.manage',
      'finance.view', 'finance.manage', 'reports.view', 'audit.view', 'hr.view'
    ]::text[]
    when 'viewer' then array[
      'clients.view', 'quotes.view', 'projects.view', 'schedule.view'
    ]::text[]
    else array[]::text[]
  end
$$;

-- (permission_delegations' check constraint calls all_permissions() per row,
-- so it picks up the new keys automatically.)

-- -----------------------------------------------------------------------------
-- Pricing settings (one row per organization)
-- VAT applies only once the company has a VAT number (organizations.vat_number).
-- -----------------------------------------------------------------------------

create table public.pricing_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  overhead_percent numeric(5, 2) not null default 0 check (overhead_percent between 0 and 100),
  min_margin_percent numeric(5, 2) not null default 20 check (min_margin_percent between 0 and 100),
  default_margin_percent numeric(5, 2) not null default 25 check (default_margin_percent between 0 and 100),
  vat_percent numeric(5, 2) not null default 15 check (vat_percent between 0 and 100),
  default_waste_percent numeric(5, 2) not null default 5 check (default_waste_percent between 0 and 100),
  default_warranty_months int not null default 6 check (default_warranty_months between 0 and 120),
  purchase_approval_limit numeric(14, 2) check (purchase_approval_limit >= 0),
  working_days_per_month numeric(4, 1) not null default 26 check (working_days_per_month between 1 and 31),
  first_payment_material_cover_percent numeric(5, 2) not null default 75 check (first_payment_material_cover_percent between 0 and 100),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create trigger pricing_settings_updated_at before update on public.pricing_settings
  for each row execute function private.set_updated_at();
create trigger pricing_settings_created_by before insert on public.pricing_settings
  for each row execute function private.set_created_by();

-- -----------------------------------------------------------------------------
-- Services, stages, spec templates
-- -----------------------------------------------------------------------------

create table public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name_ar text not null check (char_length(name_ar) between 2 and 120),
  name_en text check (char_length(name_en) <= 120),
  description text check (char_length(description) <= 2000),
  unit text not null default 'm2' check (unit in ('m2', 'm', 'piece', 'lump')),
  waste_percent numeric(5, 2) check (waste_percent between 0 and 100),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.service_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  sort_order int not null default 0,
  kind text not null default 'work' check (kind in ('prep', 'work', 'handover')),
  name_ar text not null check (char_length(name_ar) between 2 and 120),
  name_en text check (char_length(name_en) <= 120),
  -- m² one team completes per day; null = not set (no duration suggested)
  productivity_per_day numeric(10, 2) check (productivity_per_day > 0),
  -- fixed time that doesn't depend on area (drying, curing)
  fixed_days numeric(5, 2) not null default 0 check (fixed_days >= 0),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index service_stages_service_idx on public.service_stages (service_id, sort_order);

create table public.spec_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 120),
  body text not null check (char_length(body) between 2 and 4000),
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index spec_templates_service_idx on public.spec_templates (service_id, sort_order);

-- -----------------------------------------------------------------------------
-- Materials and price history
-- -----------------------------------------------------------------------------

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name_ar text not null check (char_length(name_ar) between 2 and 160),
  name_en text check (char_length(name_en) <= 160),
  category text check (char_length(category) <= 60),
  unit text not null check (unit in ('piece', 'm2', 'm', 'kg', 'liter', 'gallon', 'bag', 'roll', 'box', 'bucket', 'sheet', 'carton', 'ton')),
  -- general: returns to stock between projects; project: client-specific (colours, tiles)
  scope text not null default 'general' check (scope in ('general', 'project')),
  sku text check (char_length(sku) <= 60),
  is_active boolean not null default true,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index materials_org_idx on public.materials (organization_id, is_active);

-- Append-only price history; the latest effective price is the current one.
create table public.material_prices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  unit_price numeric(14, 4) not null check (unit_price >= 0),
  effective_from date not null default current_date,
  source text check (char_length(source) <= 160),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index material_prices_material_idx on public.material_prices (material_id, effective_from desc, created_at desc);

-- Current price per material (RLS of material_prices applies: security_invoker).
create view public.material_current_prices
with (security_invoker = true) as
select distinct on (mp.material_id)
  mp.material_id, mp.organization_id, mp.unit_price, mp.effective_from, mp.created_at
from public.material_prices mp
where mp.effective_from <= current_date
order by mp.material_id, mp.effective_from desc, mp.created_at desc;

-- -----------------------------------------------------------------------------
-- Recipes: material consumption per service unit (m²)
-- -----------------------------------------------------------------------------

create table public.service_material_recipes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete restrict,
  qty_per_unit numeric(12, 4) not null check (qty_per_unit > 0),
  waste_percent numeric(5, 2) check (waste_percent between 0 and 100),
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (service_id, material_id)
);

-- -----------------------------------------------------------------------------
-- Labour rates and extra cost items
-- -----------------------------------------------------------------------------

create table public.labour_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  service_id uuid references public.services (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  -- external_per_unit: subcontractor price per m²; external_lump: per project
  basis text not null check (basis in ('external_per_unit', 'external_lump')),
  rate numeric(14, 2) not null check (rate >= 0),
  notes text check (char_length(notes) <= 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.extra_cost_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  unit text not null default 'lump' check (unit in ('lump', 'day', 'trip', 'month')),
  default_amount numeric(14, 2) not null default 0 check (default_amount >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Employees and statutory cost items (HR — restricted)
-- -----------------------------------------------------------------------------

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  is_saudi boolean not null default false,
  nationality text check (char_length(nationality) <= 60),
  job_title text check (char_length(job_title) <= 80),
  phone text check (phone ~ '^[0-9]{8,15}$'),
  id_number text check (id_number ~ '^[0-9]{10}$'),
  id_expiry date,
  passport_expiry date,
  insurance_expiry date,
  start_date date,
  basic_salary numeric(12, 2) not null default 0 check (basic_salary >= 0),
  housing_allowance numeric(12, 2) not null default 0 check (housing_allowance >= 0),
  transport_allowance numeric(12, 2) not null default 0 check (transport_allowance >= 0),
  other_allowances numeric(12, 2) not null default 0 check (other_allowances >= 0),
  iban text check (iban ~ '^SA[0-9]{22}$'),
  status text not null default 'active' check (status in ('active', 'on_leave', 'final_exit')),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index employees_org_idx on public.employees (organization_id, status);

-- Each statutory/government cost is a configurable line (amounts change by
-- regulation — the owner maintains them; last_reviewed_at is shown in the UI).
create table public.employee_cost_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  name_ar text not null check (char_length(name_ar) between 2 and 120),
  applies_to text not null check (applies_to in ('all', 'saudi', 'non_saudi')),
  -- percent: % of contributory wage (basic + housing) per month
  -- monthly / annual: fixed amount per employee
  -- one_time: amount spread over amortize_months (visa, transfer...)
  basis text not null check (basis in ('percent', 'monthly', 'annual', 'one_time')),
  value numeric(12, 4) not null default 0 check (value >= 0),
  amortize_months int check (amortize_months between 1 and 120),
  is_active boolean not null default true,
  last_reviewed_at date,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

-- -----------------------------------------------------------------------------
-- Common triggers
-- -----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'services', 'service_stages', 'spec_templates', 'materials', 'service_material_recipes',
    'labour_rates', 'extra_cost_items', 'employees', 'employee_cost_items'
  ] loop
    execute format('create trigger %1$s_updated_at before update on public.%1$s for each row execute function private.set_updated_at()', t);
  end loop;
  foreach t in array array[
    'services', 'service_stages', 'spec_templates', 'materials', 'material_prices', 'service_material_recipes',
    'labour_rates', 'extra_cost_items', 'employees', 'employee_cost_items'
  ] loop
    execute format('create trigger %1$s_created_by before insert on public.%1$s for each row execute function private.set_created_by()', t);
  end loop;
end $$;

-- Child rows must belong to the same organization as their parent.
create or replace function private.check_same_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if tg_table_name in ('service_stages', 'spec_templates', 'service_material_recipes') then
    select s.organization_id into v_org from public.services s where s.id = new.service_id;
    if v_org is distinct from new.organization_id then
      raise exception 'service belongs to another organization' using errcode = '42501';
    end if;
  end if;
  if tg_table_name in ('material_prices', 'service_material_recipes') then
    select m.organization_id into v_org from public.materials m where m.id = new.material_id;
    if v_org is distinct from new.organization_id then
      raise exception 'material belongs to another organization' using errcode = '42501';
    end if;
  end if;
  if tg_table_name = 'labour_rates' then
    -- (nested: plpgsql doesn't short-circuit AND, and other tables lack service_id)
    if new.service_id is not null then
      select s.organization_id into v_org from public.services s where s.id = new.service_id;
      if v_org is distinct from new.organization_id then
        raise exception 'service belongs to another organization' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['service_stages', 'spec_templates', 'service_material_recipes', 'material_prices', 'labour_rates'] loop
    execute format('create trigger %1$s_same_org before insert or update on public.%1$s for each row execute function private.check_same_org()', t);
  end loop;
end $$;

-- Audit everything.
select private.enable_audit('public.pricing_settings');
select private.enable_audit('public.services');
select private.enable_audit('public.service_stages');
select private.enable_audit('public.spec_templates');
select private.enable_audit('public.materials');
select private.enable_audit('public.material_prices');
select private.enable_audit('public.service_material_recipes');
select private.enable_audit('public.labour_rates');
select private.enable_audit('public.extra_cost_items');
select private.enable_audit('public.employees');
select private.enable_audit('public.employee_cost_items');

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.pricing_settings enable row level security;
alter table public.services enable row level security;
alter table public.service_stages enable row level security;
alter table public.spec_templates enable row level security;
alter table public.materials enable row level security;
alter table public.material_prices enable row level security;
alter table public.service_material_recipes enable row level security;
alter table public.labour_rates enable row level security;
alter table public.extra_cost_items enable row level security;
alter table public.employees enable row level security;
alter table public.employee_cost_items enable row level security;

-- Catalogue structure
do $$
declare t text;
begin
  foreach t in array array['services', 'service_stages', 'spec_templates', 'materials', 'service_material_recipes'] loop
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

-- Money: read with costs.view; write with catalogue.manage AND costs.view
do $$
declare t text;
begin
  foreach t in array array['pricing_settings', 'labour_rates', 'extra_cost_items'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using ((select private.has_permission(organization_id, 'costs.view')));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check ((select private.has_permission(organization_id, 'catalogue.manage'))
                and (select private.has_permission(organization_id, 'costs.view')));
      create policy %1$s_update on public.%1$s for update to authenticated
        using ((select private.has_permission(organization_id, 'catalogue.manage'))
           and (select private.has_permission(organization_id, 'costs.view')))
        with check ((select private.has_permission(organization_id, 'catalogue.manage'))
                and (select private.has_permission(organization_id, 'costs.view')));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using ((select private.has_permission(organization_id, 'catalogue.manage'))
           and (select private.has_permission(organization_id, 'costs.view')));
    $f$, t);
  end loop;
end $$;

-- Price history is append-only: read, insert; no update/delete from the app.
create policy material_prices_select on public.material_prices for select to authenticated
  using ((select private.has_permission(organization_id, 'costs.view')));
create policy material_prices_insert on public.material_prices for insert to authenticated
  with check ((select private.has_permission(organization_id, 'catalogue.manage'))
          and (select private.has_permission(organization_id, 'costs.view')));

-- HR
do $$
declare t text;
begin
  foreach t in array array['employees', 'employee_cost_items'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using ((select private.has_permission(organization_id, 'hr.view')));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check ((select private.has_permission(organization_id, 'hr.manage')));
      create policy %1$s_update on public.%1$s for update to authenticated
        using ((select private.has_permission(organization_id, 'hr.manage')))
        with check ((select private.has_permission(organization_id, 'hr.manage')));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using ((select private.has_permission(organization_id, 'hr.manage')));
    $f$, t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------

revoke all on public.pricing_settings, public.services, public.service_stages, public.spec_templates,
  public.materials, public.material_prices, public.service_material_recipes, public.labour_rates,
  public.extra_cost_items, public.employees, public.employee_cost_items, public.material_current_prices
  from anon;

grant select, insert, update, delete on public.pricing_settings, public.services, public.service_stages,
  public.spec_templates, public.materials, public.service_material_recipes, public.labour_rates,
  public.extra_cost_items, public.employees, public.employee_cost_items to authenticated;
grant select, insert on public.material_prices to authenticated;
revoke update, delete on public.material_prices from authenticated;
grant select on public.material_current_prices to authenticated;
grant all on all tables in schema public to service_role;

-- -----------------------------------------------------------------------------
-- Starter catalogue: services, stages and spec wording (no prices, no
-- quantities — those are the owner's numbers). Idempotent; callable by
-- anyone with catalogue.manage for their organization.
-- -----------------------------------------------------------------------------

create or replace function public.seed_starter_catalogue(p_org uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int := 0;
  v_service uuid;
  r record;
begin
  if not private.has_permission(p_org, 'catalogue.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.pricing_settings (organization_id) values (p_org) on conflict do nothing;

  for r in
    select * from (values
      ('gypsum', 'أسقف وجدران جبس بورد', 'Gypsum board ceilings & partitions', 1),
      ('interior-paint', 'دهانات داخلية', 'Interior paint', 2),
      ('exterior-paint', 'دهانات خارجية', 'Exterior paint', 3),
      ('plaster', 'لياسة', 'Plaster', 4),
      ('tiling', 'بلاط وسيراميك', 'Tiling', 5)
    ) as t(code, name_ar, name_en, sort_order)
  loop
    insert into public.services (organization_id, code, name_ar, name_en, sort_order)
    values (p_org, r.code, r.name_ar, r.name_en, r.sort_order)
    on conflict (organization_id, code) do nothing
    returning id into v_service;

    if v_service is null then
      continue;
    end if;
    v_count := v_count + 1;

    insert into public.service_stages (organization_id, service_id, sort_order, kind, name_ar, name_en)
    select p_org, v_service, s.ord, s.kind, s.name_ar, s.name_en
    from (values
      ('gypsum', 1, 'prep', 'تجهيز الموقع وتحديد المناسيب', 'Site prep & levels'),
      ('gypsum', 2, 'work', 'تركيب الهيكل المعدني', 'Metal framing'),
      ('gypsum', 3, 'work', 'تركيب الألواح', 'Boards'),
      ('gypsum', 4, 'work', 'معالجة الفواصل والمعجون', 'Joint treatment & compound'),
      ('gypsum', 5, 'handover', 'التنظيف والتسليم', 'Cleaning & handover'),
      ('interior-paint', 1, 'prep', 'حماية الأرضيات والتلزيق', 'Floor protection & masking'),
      ('interior-paint', 2, 'prep', 'معالجة الأسطح والتشققات', 'Surface repair'),
      ('interior-paint', 3, 'work', 'المعجون', 'Putty'),
      ('interior-paint', 4, 'work', 'الأساس (البرايمر)', 'Primer'),
      ('interior-paint', 5, 'work', 'الوجه الأول', 'First coat'),
      ('interior-paint', 6, 'work', 'الوجه النهائي', 'Final coat'),
      ('interior-paint', 7, 'handover', 'إزالة الحماية والتنظيف', 'Removal & cleaning'),
      ('exterior-paint', 1, 'prep', 'تجهيز السقالات والحماية', 'Scaffolding & protection'),
      ('exterior-paint', 2, 'prep', 'معالجة الأسطح', 'Surface repair'),
      ('exterior-paint', 3, 'work', 'الأساس', 'Primer'),
      ('exterior-paint', 4, 'work', 'الدهان (وجهين)', 'Paint (2 coats)'),
      ('exterior-paint', 5, 'handover', 'فك السقالات والتنظيف', 'Dismantling & cleaning'),
      ('plaster', 1, 'prep', 'تجهيز السطح والزوايا', 'Surface & corner prep'),
      ('plaster', 2, 'work', 'الطرطشة', 'Spatter dash'),
      ('plaster', 3, 'work', 'البؤج والأوتار', 'Screeds & guides'),
      ('plaster', 4, 'work', 'اللياسة', 'Plastering'),
      ('plaster', 5, 'handover', 'المعالجة بالرش والتنظيف', 'Curing & cleaning'),
      ('tiling', 1, 'prep', 'تجهيز السطح والميول', 'Surface & falls'),
      ('tiling', 2, 'work', 'التركيب', 'Laying'),
      ('tiling', 3, 'work', 'الترويب', 'Grouting'),
      ('tiling', 4, 'handover', 'التنظيف والتسليم', 'Cleaning & handover')
    ) as s(code, ord, kind, name_ar, name_en)
    where s.code = r.code;

    insert into public.spec_templates (organization_id, service_id, sort_order, is_default, title, body)
    select p_org, v_service, s.ord, s.is_default, s.title, s.body
    from (values
      ('gypsum', 1, true, 'المواصفات القياسية', 'معجون الفواصل وجهين، ووجه ثالث عند الحاجة. معالجة جميع الفواصل بالشريط. تسليم السطح جاهزاً للدهان.'),
      ('interior-paint', 1, true, 'وجهين بعد الأساس', 'معجون وجهين مع الصنفرة، أساس وجه واحد، دهان وجهين. الوجه النهائي بعد تركيب الأبواب والنوافذ والإنارة.'),
      ('exterior-paint', 1, true, 'المواصفات القياسية', 'معالجة الشروخ، أساس مقاوم للقلويات، دهان خارجي وجهين.'),
      ('plaster', 1, true, 'المواصفات القياسية', 'طرطشة، ثم لياسة بسماكة متوسطة مع ضبط الاستقامة والزوايا، والمعالجة بالرش.'),
      ('tiling', 1, true, 'المواصفات القياسية', 'تركيب بالمادة اللاصقة مع ضبط المناسيب والفواصل، والترويب بلون مناسب. البلاط من توريد العميل ما لم يُذكر خلاف ذلك.')
    ) as s(code, ord, is_default, title, body)
    where s.code = r.code;

    v_service := null;
  end loop;

  return v_count;
end;
$$;

-- Statutory cost lines with zero amounts: the owner fills in current values.
create or replace function public.seed_employee_cost_items(p_org uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if not private.has_permission(p_org, 'hr.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.employee_cost_items (organization_id, code, name_ar, applies_to, basis, amortize_months, sort_order)
  values
    (p_org, 'gosi_saudi', 'التأمينات الاجتماعية (حصة المنشأة) — سعودي', 'saudi', 'percent', null, 1),
    (p_org, 'gosi_non_saudi', 'التأمينات الاجتماعية (أخطار مهنية) — غير سعودي', 'non_saudi', 'percent', null, 2),
    (p_org, 'medical_insurance', 'التأمين الطبي', 'all', 'annual', null, 3),
    (p_org, 'eos_accrual', 'مخصص مكافأة نهاية الخدمة', 'all', 'percent', null, 4),
    (p_org, 'annual_leave', 'مخصص الإجازة السنوية', 'all', 'percent', null, 5),
    (p_org, 'iqama', 'إصدار/تجديد الإقامة', 'non_saudi', 'annual', null, 6),
    (p_org, 'work_permit_levy', 'رخصة العمل والمقابل المالي', 'non_saudi', 'annual', null, 7),
    (p_org, 'exit_reentry', 'تأشيرات الخروج والعودة', 'non_saudi', 'annual', null, 8),
    (p_org, 'leave_ticket', 'تذكرة الإجازة السنوية', 'non_saudi', 'annual', null, 9),
    (p_org, 'recruitment', 'الاستقدام (تأشيرة، مكتب، تذكرة، فحص)', 'non_saudi', 'one_time', 24, 10),
    (p_org, 'sponsorship_transfer', 'نقل الكفالة / نقل الخدمات', 'non_saudi', 'one_time', 24, 11),
    (p_org, 'housing', 'السكن (إن لم يكن بدلاً في الراتب)', 'all', 'monthly', null, 12),
    (p_org, 'transport', 'النقل (إن لم يكن بدلاً في الراتب)', 'all', 'monthly', null, 13)
  on conflict (organization_id, code) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.seed_starter_catalogue(uuid) from public, anon;
revoke execute on function public.seed_employee_cost_items(uuid) from public, anon;
grant execute on function public.seed_starter_catalogue(uuid) to authenticated;
grant execute on function public.seed_employee_cost_items(uuid) to authenticated;
grant execute on function private.check_same_org() to authenticated, service_role;

-- Existing organizations get pricing settings now.
insert into public.pricing_settings (organization_id)
select id from public.organizations
on conflict do nothing;

-- New organizations get pricing settings automatically.
create or replace function private.create_pricing_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.pricing_settings (organization_id, created_by) values (new.id, new.created_by)
  on conflict do nothing;
  return new;
end;
$$;

create trigger organizations_pricing_settings after insert on public.organizations
  for each row execute function private.create_pricing_settings();
