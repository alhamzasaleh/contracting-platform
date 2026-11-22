-- =============================================================================
-- Pricing by steps (owner-agreed model):
-- 1. A pricing step can offer several products of the same kind (e.g. boards
--    12.5 mm and 15 mm, matt and silk wall paint): more than one product line
--    per role. Unique key becomes (organization, role, name).
-- 2. pricing_templates: per service, the default choices the pricing screen
--    starts from (products, brands, coats, options, labour source).
-- Non-destructive: a constraint is relaxed, a table is added.
-- =============================================================================

alter table public.equivalence_groups drop constraint equivalence_groups_organization_id_role_key;
alter table public.equivalence_groups add constraint equivalence_groups_org_role_name_key unique (organization_id, role, name);

create table public.pricing_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  service text not null check (service in ('gypsum', 'interior', 'exterior')),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 65536),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, service)
);
create trigger pricing_templates_updated_at before update on public.pricing_templates for each row execute function private.set_updated_at();
create trigger pricing_templates_created_by before insert on public.pricing_templates for each row execute function private.set_created_by();
select private.enable_audit('public.pricing_templates');

alter table public.pricing_templates enable row level security;
create policy pricing_templates_select on public.pricing_templates for select to authenticated
  using ((select private.has_permission(organization_id, 'catalogue.view')));
create policy pricing_templates_insert on public.pricing_templates for insert to authenticated
  with check ((select private.has_permission(organization_id, 'catalogue.manage')));
create policy pricing_templates_update on public.pricing_templates for update to authenticated
  using ((select private.has_permission(organization_id, 'catalogue.manage')))
  with check ((select private.has_permission(organization_id, 'catalogue.manage')));
revoke all on public.pricing_templates from anon;
grant select, insert, update on public.pricing_templates to authenticated;
grant all on public.pricing_templates to service_role;

-- Seed helpers updated for the new unique key (same behaviour otherwise).
create or replace function private.apply_scope_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
  r record;
begin
  -- Cement sealer: group + product (coverage and price left for the owner to fill in).
  insert into public.equivalence_groups (organization_id, role, name)
  values (p_org, 'sealer', 'عازل إسمنتي')
  on conflict (organization_id, role, name) do nothing;
  select id into v_group from public.equivalence_groups where organization_id = p_org and role = 'sealer' order by created_at limit 1;
  if not exists (select 1 from public.products where equivalence_group_id = v_group) then
    insert into public.products (organization_id, equivalence_group_id, name, category, purchase_unit, application, notes)
    values (p_org, v_group, 'عازل إسمنتي', 'sealer', 'kg', 'both', 'أكمل حجم العبوة والتغطية والسعر قبل استخدامه في التسعير');
  end if;

  for r in
    select * from (values
      ('interior-paint', 'sealer', 'off', null::text[]),
      ('interior-paint', 'putty', 'on', null),
      ('interior-paint', 'primer', 'on', null),
      ('interior-paint', 'sandpaper', 'on', null),
      ('interior-paint', 'floor_nylon', 'on', null),
      ('interior-paint', 'masking_tape', 'on', null),
      ('exterior-paint', 'sealer', 'off', null),
      ('exterior-paint', 'ext_primer', 'on', null),
      ('exterior-paint', 'ext_putty', 'on', array['roller', 'spray']),
      ('exterior-paint', 'acrylic', 'always', array['roller']),
      ('exterior-paint', 'profile', 'always', array['profile']),
      ('exterior-paint', 'spray_acrylic', 'always', array['spray']),
      ('gypsum-ceiling', 'rod', 'always', array['rod', 'double']),
      ('gypsum-ceiling', 'washers', 'always', array['rod', 'double']),
      ('gypsum-ceiling', 'vertical_hanger', 'always', array['vertical_c'])
    ) as t(system_code, role, inclusion, variants)
  loop
    insert into public.system_components (organization_id, system_id, role, equivalence_group_id, inclusion, variant_codes, sort_order)
    select p_org, s.id, r.role,
      (select g.id from public.equivalence_groups g where g.organization_id = p_org and g.role = r.role order by g.created_at limit 1),
      r.inclusion, r.variants, 0
    from public.systems s
    where s.organization_id = p_org and s.code = r.system_code
    on conflict (system_id, role) do update
      set inclusion = excluded.inclusion, variant_codes = excluded.variant_codes
      where public.system_components.inclusion = 'always' and public.system_components.variant_codes is null;
  end loop;
end;
$$;
revoke execute on function private.apply_scope_defaults(uuid) from public, anon, authenticated;

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

  -- Paint brands only make paint; gypsum brands only make boards & metal.
  insert into public.brands (organization_id, name, families)
  select p_org, b.name, b.families from (values
    ('جوتن Jotun', array['paint']), ('الجزيرة Al-Jazeera', array['paint']), ('الوطنية National', array['paint']),
    ('سايبس Sipes', array['paint']), ('عسيب Asib', array['paint']),
    ('مدى Mada', array['gypsum']), ('كناوف Knauf', array['gypsum']), ('جيبروك Gyproc', array['gypsum'])
  ) as b(name, families)
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
    on conflict (organization_id, role, name) do nothing
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
    select p_org, v_system, role, (select g.id from public.equivalence_groups g where g.organization_id = p_org and g.role = x.role order by g.created_at limit 1), ord
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

  perform private.apply_scope_defaults(p_org);

  return jsonb_build_object('products', v_products, 'rates', v_rates);
end;
$$;
revoke execute on function public.seed_pricing_engine(uuid) from public, anon;
grant execute on function public.seed_pricing_engine(uuid) to authenticated;
