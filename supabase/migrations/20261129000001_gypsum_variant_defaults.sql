-- =============================================================================
-- Gypsum suspension parts follow their method by default (rod & washers with
-- rod suspension, vertical hangers with vertical C). The owner can change it on
-- the Systems page. Non-destructive: only fills components still set to "all".
-- =============================================================================

-- Gypsum suspension parts follow their method by default (owner can change it).
update public.system_components c
set variant_codes = case c.role when 'vertical_hanger' then array['vertical_c'] else array['rod', 'double'] end
from public.systems s
where s.id = c.system_id and s.code = 'gypsum-ceiling'
  and c.role in ('rod', 'washers', 'vertical_hanger') and c.variant_codes is null;

-- Same defaults for organizations that seed later.
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
  on conflict (organization_id, role) do nothing;
  select id into v_group from public.equivalence_groups where organization_id = p_org and role = 'sealer';
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
      (select g.id from public.equivalence_groups g where g.organization_id = p_org and g.role = r.role),
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
