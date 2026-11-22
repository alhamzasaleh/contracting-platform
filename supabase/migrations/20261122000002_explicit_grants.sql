-- =============================================================================
-- Explicit API grants.
-- Supabase projects can be created with "Grant API access to new tables
-- automatically" switched off. These grants make the app work either way,
-- without widening anything: RLS still decides which rows a user sees, and
-- column-level UPDATE limits from the foundation migration stay in place.
-- Anonymous users still get nothing.
-- =============================================================================

grant usage on schema public to authenticated, service_role;

grant select on public.organizations to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, delete on public.memberships to authenticated;
grant select, insert, update on public.permission_delegations to authenticated;
grant select, insert, update, delete on public.member_invitations to authenticated;
grant select on public.audit_log to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

grant execute on function public.create_organization(text) to authenticated;
grant execute on function public.accept_pending_invitations() to authenticated;
grant execute on function public.can_create_organization() to authenticated;
grant execute on function public.my_permissions(uuid) to authenticated;
grant execute on function public.log_event(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;
grant execute on function public.auth_phone_allowed(text) to service_role;
