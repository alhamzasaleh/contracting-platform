-- Bill of quantities (owner, Nov 2026): the purchaser needs every material's packs to buy, the
-- quantity needed and the expected leftover — without prices.
--
-- The frozen purchase list and engine lines live in quote_version_costs, readable only with
-- quotes.view AND costs.view (they carry costs). public.quote_version_quantities() hands a caller
-- with quotes.view the QUANTITIES of one version and nothing else:
--   items = purchase_list without "cost" (key, label, brand, colour, packs {size,count}, qty, unit,
--           leftover, productId — none of them a price)
--   needs = per material / hatch line only key, need, needUnit and perPack (no unitPrice / cost / inputs)
-- SECURITY DEFINER (it reads a costs.view table); same permission as quote_versions' own policy.

create or replace function public.quote_version_quantities(p_version uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_items jsonb;
  v_needs jsonb;
begin
  select v.organization_id into v_org from public.quote_versions v where v.id = p_version;
  if v_org is null or not private.has_permission(v_org, 'quotes.view') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', i -> 'key', 'label', i -> 'label', 'brand', i -> 'brand', 'colour', i -> 'colour',
        'packs', coalesce((select jsonb_agg(jsonb_build_object('size', k -> 'size', 'count', k -> 'count')) from jsonb_array_elements(case when jsonb_typeof(i -> 'packs') = 'array' then i -> 'packs' else '[]'::jsonb end) k), '[]'::jsonb),
        'qty', i -> 'qty', 'unit', i -> 'unit', 'leftover', i -> 'leftover', 'productId', i -> 'productId'
      ) order by o)
      from jsonb_array_elements(c.purchase_list) with ordinality as x (i, o)
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', l -> 'key', 'need', l -> 'need', 'needUnit', l -> 'needUnit',
        'perPack', case when l #>> '{purchase,kind}' = 'units' then l #> '{purchase,perPack}' else null end
      ) order by o)
      from jsonb_array_elements(c.lines) with ordinality as y (l, o)
      where l ->> 'group' in ('material', 'hatch')
    ), '[]'::jsonb)
  into v_items, v_needs
  from public.quote_version_costs c
  where c.quote_version_id = p_version;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'needs', coalesce(v_needs, '[]'::jsonb));
end;
$$;

revoke all on function public.quote_version_quantities(uuid) from public, anon;
grant execute on function public.quote_version_quantities(uuid) to authenticated, service_role;
