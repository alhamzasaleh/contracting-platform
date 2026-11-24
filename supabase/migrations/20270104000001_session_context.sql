-- Faster pages (Nov 2026): the signed-in user's session in ONE database round trip.
--
-- Every page starts with getSession(): profile + active memberships, then the current
-- organization + effective permissions — two sequential round trips before any page data.
-- public.session_context() returns the same four things at once.
--
-- SECURITY INVOKER: each read runs as the caller, through exactly the same RLS policies as
-- the separate queries it replaces (profiles / memberships / organizations), and the
-- permissions come from the existing public.my_permissions(). Nothing new becomes visible.
-- Returns null when there is no signed-in user or no profile.

create or replace function public.session_context()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_memberships jsonb;
  v_org uuid;
  v_organization public.organizations;
begin
  if v_uid is null then
    return null;
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('organization_id', m.organization_id, 'role', m.role) order by m.created_at, m.organization_id), '[]'::jsonb)
    into v_memberships
    from public.memberships m
   where m.user_id = v_uid and m.status = 'active';

  -- the profile's default organization when he is an active member there, else the first one
  select coalesce(
           (select (e ->> 'organization_id')::uuid from jsonb_array_elements(v_memberships) e
             where (e ->> 'organization_id')::uuid = v_profile.default_organization_id limit 1),
           (v_memberships -> 0 ->> 'organization_id')::uuid)
    into v_org;

  if v_org is not null then
    select * into v_organization from public.organizations where id = v_org;
  end if;

  return jsonb_build_object(
    'profile', to_jsonb(v_profile),
    'memberships', v_memberships,
    'organization_id', v_org,
    'organization', case when v_organization.id is null then null else to_jsonb(v_organization) end,
    'permissions', case when v_org is null then '[]'::jsonb else to_jsonb(public.my_permissions(v_org)) end
  );
end;
$$;

revoke all on function public.session_context() from public, anon;
grant execute on function public.session_context() to authenticated;
