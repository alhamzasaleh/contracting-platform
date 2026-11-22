-- =============================================================================
-- Owner decision: he controls whether ANY component is always priced or
-- optional per client — including finish coats and gypsum parts. Remove the
-- database guard added in 20261127000001 (schema-only change; no data touched).
-- =============================================================================

drop trigger if exists system_components_inclusion on public.system_components;
drop function if exists private.check_component_inclusion();
