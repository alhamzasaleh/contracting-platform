-- =============================================================================
-- Owner feedback fixes (non-destructive data corrections):
-- 1. The exterior profile product was seeded with a coverage (60 m²/18 L) that
--    is NOT in the owner's Excel. Clear it (only if never edited and unpriced)
--    so the app asks for the real value instead of pricing with a guess.
-- 2. Finish coats and gypsum parts are always priced; reset any that were
--    switched to optional.
-- =============================================================================

update public.products p
set coverage_per_pack = null,
    notes = 'أكمل حجم العبوة والتغطية والسعر من بيانات المورد قبل التسعير'
where p.name = 'بروفايل خارجي'
  and p.coverage_per_pack = 60
  and p.updated_at = p.created_at
  and not exists (select 1 from public.product_prices pr where pr.product_id = p.id);

update public.system_components c
set inclusion = 'always'
from public.systems s
where s.id = c.system_id
  and c.inclusion <> 'always'
  and (c.role in ('wall_finish', 'ceiling_paint', 'moisture', 'decorative', 'acrylic', 'profile', 'spray_acrylic')
       or s.kind in ('gypsum_ceiling', 'gypsum_partition'));

-- Same rule enforced in the database, so no client can make the finish optional.
create or replace function private.check_component_inclusion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare v_kind text;
begin
  if new.inclusion <> 'always' then
    select kind into v_kind from public.systems where id = new.system_id;
    if new.role in ('wall_finish', 'ceiling_paint', 'moisture', 'decorative', 'acrylic', 'profile', 'spray_acrylic')
       or v_kind in ('gypsum_ceiling', 'gypsum_partition') then
      raise exception 'this component is always included' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
grant execute on function private.check_component_inclusion() to authenticated, service_role;

create trigger system_components_inclusion
  before insert or update of inclusion on public.system_components
  for each row execute function private.check_component_inclusion();
